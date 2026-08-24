@echo off
cd /d "%~dp0route-optimizer"
if not defined SECRET_KEY set ALLOW_INSECURE_DEV_KEY=1
REM 카카오 주소검색을 쓰려면 이 줄의 REM을 지우고 본인 키를 넣으세요(없어도 Nominatim으로 검색은 동작함)
REM set KAKAO_REST_API_KEY=여기에_카카오_REST_API_키
echo Starting server... http://localhost:5000
python app.py
pause
