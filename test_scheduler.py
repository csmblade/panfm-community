"""
Diagnostic script to test APScheduler setup
Run this to verify scheduler is working independently of Flask
"""
import sys
import time
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.events import EVENT_JOB_EXECUTED, EVENT_JOB_ERROR, EVENT_JOB_MISSED

# Event counters
execution_count = 0
error_count = 0

def on_job_executed(event):
    global execution_count
    execution_count += 1
    print(f"[{datetime.now().isoformat()}] ✓ Job executed successfully (count: {execution_count})")

def on_job_error(event):
    global error_count
    error_count += 1
    print(f"[{datetime.now().isoformat()}] ✗ Job error: {event.exception}")

def on_job_missed(event):
    print(f"[{datetime.now().isoformat()}] ⚠ Job missed execution")

def test_job():
    """Simple test job"""
    now = datetime.now().isoformat()
    print(f"[{now}] ► TEST JOB RUNNING")
    # Simulate some work
    time.sleep(0.1)
    print(f"[{now}] ✓ TEST JOB COMPLETED")

if __name__ == '__main__':
    print("=" * 60)
    print("APScheduler Diagnostic Test")
    print("=" * 60)

    # Create scheduler
    print("\n1. Creating BackgroundScheduler...")
    scheduler = BackgroundScheduler(
        timezone='UTC',
        job_defaults={
            'misfire_grace_time': 60,
            'coalesce': True,
            'max_instances': 1
        }
    )
    print("   ✓ Scheduler created")

    # Add event listeners
    print("\n2. Adding event listeners...")
    scheduler.add_listener(on_job_executed, EVENT_JOB_EXECUTED)
    scheduler.add_listener(on_job_error, EVENT_JOB_ERROR)
    scheduler.add_listener(on_job_missed, EVENT_JOB_MISSED)
    print("   ✓ Event listeners added")

    # Add test job (every 5 seconds)
    print("\n3. Adding test job (runs every 5 seconds)...")
    scheduler.add_job(
        func=test_job,
        trigger='interval',
        seconds=5,
        id='test_job',
        name='Test Job'
    )
    print("   ✓ Test job added")

    # Start scheduler
    print("\n4. Starting scheduler...")
    scheduler.start()
    print("   ✓ Scheduler started")

    # Check scheduler state
    print("\n5. Scheduler State:")
    print(f"   - Running: {scheduler.running}")
    print(f"   - Jobs: {len(scheduler.get_jobs())}")

    jobs = scheduler.get_jobs()
    for job in jobs:
        print(f"   - Job ID: {job.id}")
        print(f"     Name: {job.name}")
        print(f"     Next run: {job.next_run_time}")
        print(f"     Trigger: {job.trigger}")

    # Wait and monitor
    print("\n6. Monitoring for 30 seconds...")
    print("   (Watch for '[TEST JOB RUNNING]' messages)")
    print("-" * 60)

    try:
        for i in range(30):
            time.sleep(1)
            if i % 5 == 0:
                print(f"   [{i}s] Waiting... (executions: {execution_count}, errors: {error_count})")
    except KeyboardInterrupt:
        print("\n   Interrupted by user")

    # Shutdown
    print("\n7. Shutting down scheduler...")
    scheduler.shutdown()
    print("   ✓ Scheduler stopped")

    # Final report
    print("\n" + "=" * 60)
    print("RESULTS:")
    print(f"  Total executions: {execution_count}")
    print(f"  Total errors: {error_count}")

    if execution_count > 0:
        print("\n  ✅ SUCCESS - Scheduler is working!")
    else:
        print("\n  ❌ FAILURE - Jobs did not execute!")
        print("\n  Possible causes:")
        print("  - Scheduler not starting correctly")
        print("  - Job trigger not firing")
        print("  - Event listeners not being called")

    print("=" * 60)

    sys.exit(0 if execution_count > 0 else 1)
