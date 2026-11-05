# -*- coding: utf-8 -*-
"""
Database "VFO Record": setiap rekaman radio (Rekam & Simpan, Rekam & Translate)
tercatat di SQLite bersama info radio (sumber, frekuensi, mode, bandwidth),
bahasa, durasi, teks Papua, terjemahan dan catatan operator.

File database: <DATA_DIR>/rekaman.db, file audio WAV di <DATA_DIR>/rekaman_radio/
(kolom `file` menyimpan path relatif terhadap folder itu). Database baru dibuka
saat pertama dipakai, jadi mengimpor aplikasi tidak membuat file apa pun.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

COLUMNS = (
    "created_at", "kind", "source", "freq_hz", "mode", "bandwidth_hz", "lang",
    "duration_sec", "sample_rate", "segments", "file", "text_papua",
    "text_indonesia", "note",
)
KINDS = ("simpan", "terjemah")
NOTE_MAX_CHARS = 2000

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at     TEXT NOT NULL,
    kind           TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT '',
    freq_hz        INTEGER,
    mode           TEXT,
    bandwidth_hz   INTEGER,
    lang           TEXT NOT NULL DEFAULT '',
    duration_sec   REAL NOT NULL DEFAULT 0,
    sample_rate    INTEGER NOT NULL DEFAULT 0,
    segments       INTEGER NOT NULL DEFAULT 0,
    file           TEXT,
    text_papua     TEXT NOT NULL DEFAULT '',
    text_indonesia TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS records_created ON records (created_at);
"""


def now_iso() -> str:
    """Waktu lokal ISO 8601 dengan offset zona waktu, presisi detik."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


class RecordsDB:
    def __init__(self, path, audio_dir):
        self.path = Path(path)
        self.audio_dir = Path(audio_dir)
        self._lock = threading.Lock()
        self._conn: Optional[sqlite3.Connection] = None

    # ------------------------------------------------------------------
    def _db(self) -> sqlite3.Connection:
        if self._conn is None:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self.path), check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.executescript(SCHEMA)
            conn.commit()
            self._conn = conn
        return self._conn

    def close(self):
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    def audio_path(self, item: dict) -> Optional[Path]:
        """Path WAV absolut sebuah rekaman, hanya bila berada di dalam audio_dir."""
        name = item.get("file")
        if not name:
            return None
        root = self.audio_dir.resolve()
        path = (root / name).resolve()
        return path if root in path.parents else None

    def _item(self, row) -> dict:
        item = dict(row)
        path = self.audio_path(item)
        item["has_audio"] = bool(path and path.is_file())
        return item

    # ------------------------------------------------------------------
    def add(self, **fields) -> int:
        values = {key: fields.get(key) for key in COLUMNS}
        if values["kind"] not in KINDS:
            raise ValueError(f"kind harus salah satu dari {KINDS}")
        values["created_at"] = values["created_at"] or now_iso()
        for key in ("source", "lang", "text_papua", "text_indonesia", "note"):
            values[key] = values[key] or ""
        values["duration_sec"] = float(values["duration_sec"] or 0.0)
        for key in ("sample_rate", "segments"):
            values[key] = int(values[key] or 0)
        for key in ("freq_hz", "bandwidth_hz"):
            values[key] = None if values[key] is None else int(values[key])
        values["note"] = values["note"][:NOTE_MAX_CHARS]
        with self._lock:
            conn = self._db()
            cur = conn.execute(
                f"INSERT INTO records ({', '.join(COLUMNS)}) VALUES ({', '.join('?' for _ in COLUMNS)})",
                [values[key] for key in COLUMNS],
            )
            conn.commit()
            return int(cur.lastrowid)

    def get(self, record_id: int) -> Optional[dict]:
        with self._lock:
            row = self._db().execute("SELECT * FROM records WHERE id = ?", (int(record_id),)).fetchone()
        return self._item(row) if row else None

    def list(self, q: str = "", lang: str = "", kind: str = "", limit: int = 100, offset: int = 0):
        """(total, item terbaru dulu). q dicari (tanpa beda huruf besar/kecil) di teks Papua,
        terjemahan, catatan dan sumber."""
        where, args = [], []
        if q:
            like = f"%{q.lower()}%"
            where.append("(lower(text_papua) LIKE ? OR lower(text_indonesia) LIKE ? OR lower(note) LIKE ? OR lower(source) LIKE ?)")
            args += [like] * 4
        if lang:
            where.append("lang = ?")
            args.append(lang)
        if kind:
            where.append("kind = ?")
            args.append(kind)
        clause = f" WHERE {' AND '.join(where)}" if where else ""
        with self._lock:
            conn = self._db()
            total = conn.execute(f"SELECT COUNT(*) FROM records{clause}", args).fetchone()[0]
            rows = conn.execute(
                f"SELECT * FROM records{clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
                [*args, int(limit), max(int(offset), 0)],
            ).fetchall()
        return int(total), [self._item(row) for row in rows]

    def update_note(self, record_id: int, note: str) -> Optional[dict]:
        with self._lock:
            conn = self._db()
            cur = conn.execute("UPDATE records SET note = ? WHERE id = ?",
                               (str(note or "")[:NOTE_MAX_CHARS], int(record_id)))
            conn.commit()
            if cur.rowcount == 0:
                return None
        return self.get(record_id)

    def delete(self, record_id: int) -> bool:
        item = self.get(record_id)
        if item is None:
            return False
        with self._lock:
            conn = self._db()
            conn.execute("DELETE FROM records WHERE id = ?", (int(record_id),))
            conn.commit()
        path = self.audio_path(item)
        if path and path.is_file():
            path.unlink()
        return True
