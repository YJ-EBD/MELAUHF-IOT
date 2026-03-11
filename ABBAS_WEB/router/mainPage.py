from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter()
templates = Jinja2Templates(directory="templates")


@router.get("/", response_class=HTMLResponse)
async def main_page(request: Request):
    # Keep logic out of main.py per requirements.
    context = {
        "request": request,
        "user_name": "Admin",
        "stats": [
            {"label": "Active Devices", "value": 2, "delta": "+1 today"},
            {"label": "Running Sessions", "value": 0, "delta": "-"},
            {"label": "Alerts", "value": 0, "delta": "All clear"},
            {"label": "Uptime", "value": "99.9%", "delta": "last 30d"},
        ],
    }
    return templates.TemplateResponse("index.html", context)
