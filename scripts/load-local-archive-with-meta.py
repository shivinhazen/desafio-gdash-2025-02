#!/usr/bin/env python3
"""Wrapper that reuses `load-local-archive.py` while keeping a separate entry point."""

from load_local_archive import main as load_local_main


if __name__ == "__main__":
    load_local_main()
