@echo off
cd /d "%~dp0"
echo Сборка цифрового стола...
call npm.cmd run table || goto fail
echo.
echo Откройте http://127.0.0.1:4174 в браузере.
echo Ctrl+C останавливает сервер.
call npm.cmd run table:serve
goto end
:fail
echo.
echo Сборка не удалась. Если нет dist/table.html, выполните один раз:
echo   python scripts/pack-table-images.py
:end
pause
