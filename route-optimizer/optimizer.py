"""
optimizer.py — OR-Tools TSP (Open TSP / 종단 고정 분기)

solve(matrix, start_idx, end_idx=None, time_limit_sec=2) → list[int]
  matrix: {"durations": [[...], ...]}  (인덱스 기준)
  start_idx: depot 인덱스
  end_idx: 종단 고정 시 인덱스, None이면 Open TSP
  반환: 방문 순서 인덱스 리스트 (depot 제외)
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
