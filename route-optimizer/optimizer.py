"""
optimizer.py — OR-Tools TSP (Open TSP / 종단 고정 분기) + N일 배분

solve(matrix, start_idx, end_idx=None, time_limit_sec=2) → list[int]
  matrix: {"durations": [[...], ...]}  (인덱스 기준)
  start_idx: depot 인덱스
  end_idx: 종단 고정 시 인덱스, None이면 Open TSP
  반환: 방문 순서 인덱스 리스트 (depot 제외)

assign_days(full_matrix, all_keys, pool_ids, day_configs, work_minutes, stay_minutes) → list[list[str]]
  pool_ids: 배분할 지점 id 리스트
  day_configs: [{"start_key": str, "end_key": str|None}, ...]
  work_minutes: 하루 업무 가용 분
  stay_minutes: 지점당 체류 분
  반환: 날짜별 지점 id 리스트 (마지막 날은 남은 전부)
"""
from ortools.constraint_solver import pywrapcp, routing_enums_pb2


def solve(matrix: dict, start_idx: int, end_idx=None, time_limit_sec: int = 1) -> list[int]:
    durations = matrix["durations"]
    n = len(durations)

    if n <= 1:
        return list(range(n))

    # ── Open TSP 처리 ────────────────────────────────────────────────────────
    # OR-Tools는 depot→depot 순환 TSP만 지원.
    # Open TSP(도착지 미지정): 가상 depot을 추가하고, 모든 노드와의 거리를 0으로 설정.
    # 종단 고정: end_idx 를 depot 으로 사용하지 않고,
    #            depot(start)→...→end 형태로 처리하기 위해
    #            가상 dummy node를 추가해 end→dummy 비용을 0으로 설정.

    use_dummy = True  # 항상 dummy node 추가 방식 사용

    # dummy node 인덱스
    dummy = n
    n_ext = n + 1

    def duration_callback_ext(i, j):
        if i == dummy or j == dummy:
            return 0
        return int(durations[i][j])

    manager = pywrapcp.RoutingIndexManager(n_ext, 1, [start_idx], [dummy])
    routing = pywrapcp.RoutingModel(manager)

    cb_idx = routing.RegisterTransitCallback(
        lambda i, j: duration_callback_ext(
            manager.IndexToNode(i), manager.IndexToNode(j)
        )
    )
    routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

    # 종단 고정: end_idx → dummy 비용 0 이외 모든 노드 → dummy 비용을 크게 설정해
    #            end_idx 가 마지막이 되도록 유도
    if end_idx is not None and end_idx != start_idx:
        penalty = 10 ** 9
        # end_idx 제외한 노드에서 dummy 로의 비용을 크게 부과
        for node in range(n):
            if node == dummy or node == start_idx or node == end_idx:
                continue
            from_idx = manager.NodeToIndex(node)
            to_dummy = manager.NodeToIndex(dummy)
            # 직접 아크 비용 조작 불가 → disjunction penalty 미사용,
            # 대신 dummy 노드의 비용 콜백을 수정해야 하므로
            # 여기서는 보조 dimension 으로 구현
            pass  # OR-Tools 제약으로 아래 dimension 방식 사용

        # end_idx → dummy 을 저비용, 나머지 → dummy 고비용 으로 보장하기 어려움.
        # 대신: end_idx 를 새 depot 으로 설정하고 start_idx 를 source 로 지정하는 방법.
        # OR-Tools RoutingModel(n, 1, start, end) 에서 end 는 마지막 방문 노드가 됨.
        # → manager 재생성
        manager = pywrapcp.RoutingIndexManager(n, 1, [start_idx], [end_idx])
        routing = pywrapcp.RoutingModel(manager)

        def duration_callback(i, j):
            return int(durations[manager.IndexToNode(i)][manager.IndexToNode(j)])

        cb_idx = routing.RegisterTransitCallback(duration_callback)
        routing.SetArcCostEvaluatorOfAllVehicles(cb_idx)

    # ── 탐색 파라미터 ────────────────────────────────────────────────────────
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    # 소규모(≤20 노드): time_limit 없이 PATH_CHEAPEST_ARC 초기해를 즉시 반환
    # → 20개 이하에서 밀리초 이내 응답 (plan.md 성능 목표)
    # 대규모(>20 노드): GLS + time_limit_sec 초 탐색
    if n > 20:
        params.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        params.time_limit.seconds = time_limit_sec

    solution = routing.SolveWithParameters(params)

    if not solution:
        # 해를 못 찾으면 입력 순서 그대로 반환
        nodes = list(range(n))
        nodes.remove(start_idx)
        if end_idx is not None and end_idx in nodes:
            nodes.remove(end_idx)
            nodes.append(end_idx)
        return nodes

    # ── 경로 추출 ─────────────────────────────────────────────────────────────
    route = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != start_idx and node < n:  # dummy(n) 제외
            route.append(node)
        index = solution.Value(routing.NextVar(index))
    # 마지막 노드(end) 처리
    last_node = manager.IndexToNode(index)
    if end_idx is not None and last_node == end_idx:
        route.append(last_node)

    return route


# ── N일 배분 ──────────────────────────────────────────────────────────────────

def assign_days(
    full_matrix: dict,
    all_keys: list,
    pool_ids: list,
    day_configs: list,
    work_minutes: int,
    stay_minutes: int,
) -> list:
    """
    Greedy Nearest-Neighbor 방식으로 pool_ids 를 N일에 배분한다.

    full_matrix: get_matrix() 반환값 (all_keys 전체 포함)
    all_keys:    full_matrix의 행/열 순서와 1:1인 키 리스트
    pool_ids:    배분할 지점 id 리스트
    day_configs: [{"start_key": str, "end_key": str|None}, ...]
    work_minutes: 하루 가용 업무 시간(분)
    stay_minutes: 지점당 체류 시간(분)

    반환: 날별 id 리스트 [ [id, ...], [id, ...], ... ]
         - 마지막 날은 남은 지점 전부
         - 풀 소진 후 날은 빈 리스트
    """
    durations = full_matrix["durations"]
    key_idx = {k: i for i, k in enumerate(all_keys)}

    remaining = list(pool_ids)
    result = []
    n_days = len(day_configs)

    for day_num, cfg in enumerate(day_configs):
        if not remaining:
            result.append([])
            continue

        # 마지막 날: 남은 전부 배정
        if day_num == n_days - 1:
            result.append(list(remaining))
            remaining = []
            continue

        start_key = cfg["start_key"]
        end_key = cfg.get("end_key")

        # 현재 위치 키 (출발지 기준)
        cur_key = start_key
        budget = work_minutes  # 남은 가용 시간(분)
        day_ids = []

        pool_set = set(remaining)

        while pool_set and budget > stay_minutes:
            cur_idx = key_idx.get(cur_key)
            if cur_idx is None:
                break

            # 현재 위치에서 가장 가까운 미배정 지점 탐색
            best_id = None
            best_dur = float("inf")
            for cand_id in pool_set:
                cand_idx = key_idx.get(cand_id)
                if cand_idx is None:
                    continue
                dur_sec = durations[cur_idx][cand_idx]
                dur_min = dur_sec / 60.0
                if dur_min < best_dur:
                    best_dur = dur_min
                    best_id = cand_id

            if best_id is None:
                break

            # 도착지까지 돌아가는 비용 계산 (end_key가 있을 때)
            cost_min = best_dur + stay_minutes  # 이동 + 체류
            if end_key and end_key in key_idx:
                best_cand_idx = key_idx[best_id]
                end_idx = key_idx[end_key]
                return_min = durations[best_cand_idx][end_idx] / 60.0
            else:
                return_min = 0.0

            if cost_min + return_min > budget:
                break  # 예산 초과 → 오늘 배정 종료

            day_ids.append(best_id)
            pool_set.discard(best_id)
            budget -= cost_min
            cur_key = best_id

        result.append(day_ids)
        # remaining 에서 오늘 배정된 지점 제거
        assigned_set = set(day_ids)
        remaining = [pid for pid in remaining if pid not in assigned_set]

    return result
