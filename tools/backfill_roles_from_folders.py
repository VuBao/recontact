#!/usr/bin/env python3
"""Safely propose or apply CV-folder role assignments by PDF SHA-256.

Dry-run is the default. Candidate identity is matched only through file_hash;
file and candidate names are never used as identity fallbacks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import unicodedata
import uuid
from collections import defaultdict
from pathlib import Path


def normalize_title(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    title = " ".join(unicodedata.normalize("NFKC", value).split())
    if not title or len(title) > 160 or any(ord(char) < 32 or ord(char) == 127 for char in title):
        return None
    return title


def title_key(title: str) -> str:
    return title.lower()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_mapping(path: Path) -> dict[str, str]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read mapping: {error}") from error
    if not isinstance(raw, dict) or not raw:
        raise ValueError("Mapping must be a non-empty JSON object.")
    mapping: dict[str, str] = {}
    for folder, role in raw.items():
        normalized = normalize_title(role)
        if not isinstance(folder, str) or not folder.strip() or not normalized:
            raise ValueError("Every mapping entry needs an exact folder name and a valid role title.")
        mapping[folder] = normalized
    return mapping


def load_candidate_hashes(export_path: Path | None, database: Path | None) -> list[dict[str, str]]:
    if database:
        with sqlite3.connect(database) as connection:
            rows = connection.execute(
                "SELECT id, file_hash FROM candidates WHERE file_hash IS NOT NULL AND file_hash <> ''"
            ).fetchall()
        return [{"id": row[0], "file_hash": row[1]} for row in rows]
    if not export_path or not export_path.is_file():
        raise ValueError("Candidate hash export is required unless --database is provided.")
    try:
        rows = json.loads(export_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Could not read candidate hash export: {error}") from error
    if not isinstance(rows, list):
        raise ValueError("Candidate hash export must be a JSON array.")
    return rows


def build_report(root: Path, mapping: dict[str, str], candidates: list[dict[str, str]]) -> dict:
    candidates_by_hash: dict[str, list[str]] = defaultdict(list)
    for row in candidates:
        candidate_id = row.get("id") if isinstance(row, dict) else None
        digest = row.get("file_hash") if isinstance(row, dict) else None
        if isinstance(candidate_id, str) and isinstance(digest, str) and digest:
            candidates_by_hash[digest.lower()].append(candidate_id)

    files_by_hash: dict[str, list[Path]] = defaultdict(list)
    unmapped: list[str] = []
    for pdf in sorted(root.rglob("*.pdf")):
        relative = pdf.relative_to(root)
        if len(relative.parts) < 2 or relative.parts[0] not in mapping:
            unmapped.append(str(relative))
            continue
        files_by_hash[file_sha256(pdf)].append(pdf)

    proposals = []
    unmatched = []
    ambiguous = []
    for digest, paths in sorted(files_by_hash.items()):
        relative_paths = [str(path.relative_to(root)) for path in paths]
        candidate_ids = candidates_by_hash.get(digest, [])
        if len(paths) != 1 or len(candidate_ids) != 1:
            item = {"file_hash": digest, "paths": relative_paths, "candidate_ids": candidate_ids}
            if not candidate_ids:
                unmatched.append(item)
            else:
                ambiguous.append(item)
            continue
        folder = paths[0].relative_to(root).parts[0]
        proposals.append({
            "candidate_id": candidate_ids[0],
            "file_hash": digest,
            "folder": folder,
            "role_title": mapping[folder]
        })

    return {
        "mode": "dry-run",
        "counts": {
            "matched": len(proposals), "unmatched": len(unmatched),
            "ambiguous": len(ambiguous), "unmapped": len(unmapped)
        },
        "proposals": proposals,
        "unmatched": unmatched,
        "ambiguous": ambiguous,
        "unmapped_paths": unmapped
    }


def apply_report(database: Path, report: dict) -> tuple[int, list[dict]]:
    applied = 0
    conflicts: list[dict] = []
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        for proposal in report["proposals"]:
            candidate_id = proposal["candidate_id"]
            role = proposal["role_title"]
            key = title_key(role)
            existing = connection.execute(
                """SELECT j.id, j.title FROM job_candidates jc
                   JOIN jobs j ON j.id = jc.job_id
                   WHERE jc.candidate_id = ? AND j.status = 'OPEN'""",
                (candidate_id,)
            ).fetchall()
            if existing and not (len(existing) == 1 and existing[0][1] == role):
                conflicts.append({"candidate_id": candidate_id, "existing_roles": [row[1] for row in existing]})
                continue
            job = connection.execute(
                "SELECT id FROM jobs WHERE title_key = ? AND status = 'OPEN' ORDER BY created_at LIMIT 1",
                (key,)
            ).fetchone()
            job_id = job[0] if job else str(uuid.uuid4())
            if not job:
                connection.execute(
                    "INSERT INTO jobs (id, title, title_key, location, status) VALUES (?, ?, ?, NULL, 'OPEN')",
                    (job_id, role, key)
                )
            before = connection.total_changes
            connection.execute(
                "INSERT OR IGNORE INTO job_candidates (id, job_id, candidate_id, status) VALUES (?, ?, ?, 'SELECTED')",
                (str(uuid.uuid4()), job_id, candidate_id)
            )
            if connection.total_changes > before:
                applied += 1
    return applied, conflicts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="Root containing one role folder per first path segment")
    parser.add_argument("--mapping", type=Path, required=True, help="Explicit folder-to-role JSON mapping")
    parser.add_argument("--candidate-hashes", type=Path, help="JSON export containing only candidate id and file_hash")
    parser.add_argument("--database", type=Path, help="Local disposable D1/SQLite database")
    parser.add_argument("--report", type=Path, help="Write the report to this ignored local path")
    parser.add_argument("--apply", action="store_true", help="Apply safe proposals; requires --database")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if not args.root.is_dir():
            raise ValueError("CV root directory does not exist.")
        if args.apply and not args.database:
            raise ValueError("--apply requires an explicit --database target.")
        mapping = load_mapping(args.mapping)
        candidates = load_candidate_hashes(args.candidate_hashes, args.database)
        report = build_report(args.root, mapping, candidates)
        if args.apply:
            applied, conflicts = apply_report(args.database, report)
            report["mode"] = "apply"
            report["counts"]["applied"] = applied
            report["counts"]["existing_role_conflicts"] = len(conflicts)
            report["existing_role_conflicts"] = conflicts
        output = json.dumps(report, ensure_ascii=False, indent=2)
        if args.report:
            args.report.write_text(output + "\n", encoding="utf-8")
        print(output)
        return 0
    except (ValueError, OSError, sqlite3.Error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
