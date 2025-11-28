"""
PANfm Schema Management Package

Provides robust database schema initialization for TimescaleDB.
Handles both Community and Enterprise editions with:
- Idempotent table creation (safe to run multiple times)
- Error-tolerant execution (logs errors, continues)
- Progress reporting for debugging
"""

from .manager import SchemaManager

__all__ = ['SchemaManager']
