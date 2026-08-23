"""
tests/conftest.py — pytest 전역 설정.

app.py는 SECRET_KEY 환경변수가 없으면 시작을 거부한다(운영 배포 시 인증 우회를
막기 위함). 테스트는 실배포가 아니므로 로컬 개발용 옵트인 플래그를 미리
설정해 테스트 스위트가 계속 동작하도록 한다. 이 파일은 다른 conftest.py나
테스트 모듈이 `import app`을 실행하기 전, 수집(collection) 시점에 로드되므로
여기서 os.environ을 설정하는 것으로 충분하다.
"""
import os

os.environ.setdefault("ALLOW_INSECURE_DEV_KEY", "1")
