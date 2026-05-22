# Data Engineering Sandbox

OpenShell sandbox image pre-configured with Python 3.12 and popular data engineering libraries for local data processing, transformation, and analysis.

## What's Included

- **Python 3.12** — Pinned runtime for stable data engineering workflows
- **DuckDB** — Fast in-process analytical SQL engine; query CSV, Parquet, JSON, and more directly from Python or SQL
- **pandas** — DataFrame library for data manipulation and analysis
- **pyarrow** — Apache Arrow columnar format; Parquet read/write and zero-copy data interchange
- **httpx** — Async-capable HTTP client for fetching remote datasets and APIs
- Everything from the [base sandbox](../base/README.md)

## Build

```bash
docker build -t openshell-data-eng .
```

To build against a specific base image:

```bash
docker build -t openshell-data-eng --build-arg BASE_IMAGE=ghcr.io/nvidia/openshell-community/sandboxes/base:latest .
```

## Usage

### Create a sandbox

```bash
openshell sandbox create --from data-eng
```

### Quick start

All data tools are available from the pre-configured venv:

```python
import duckdb
import pandas as pd
import pyarrow as pa
import httpx

# Query a local Parquet file with DuckDB
df = duckdb.sql("SELECT * FROM 'data.parquet' LIMIT 10").df()

# Fetch a remote CSV and load into pandas
response = httpx.get("https://example.com/data.csv")
```
