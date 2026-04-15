"""
prefetch.py
서버 기동 시 백그라운드 스레드로 전체 OSRM 행렬 프리페치.
Step 3에서 distance_matrix.get_matrix 완성 후 실제 호출 연결.
"""
import threading
import sys


def start_prefetch(locations: list):
    """locations 리스트를 받아 백그라운드에서 행렬을 미리 계산."""
    thread = threading.Thread(target=_prefetch_worker, args=(locations,), daemon=True)
    thread.start()
    return thread


def _prefetch_worker(locations: list):
    print("[prefetch] started", flush=True)
    try:
        from distance_matrix import get_matrix
        coords = [(loc["lat"], loc["lng"]) for loc in locations]
        keys = [loc["id"] for loc in locations]
        get_matrix(coords, keys)
        print("[prefetch] done", flush=True)
    except Exception as e:
        print(f"[prefetch] error: {e}", file=sys.stderr, flush=True)
