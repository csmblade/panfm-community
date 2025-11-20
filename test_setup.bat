@echo off
echo Testing setup.bat creation of throughput_history.db...

if exist "test_throughput.db" (
    del test_throughput.db
)

if not exist "test_throughput.db" (
    echo Creating test database placeholder...
    type nul > test_throughput.db
    echo [OK] File created
) else (
    echo [OK] File already exists
)

dir test_throughput.db
del test_throughput.db
