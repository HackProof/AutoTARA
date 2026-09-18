FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/module:/app/module/core

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY module ./module
COPY api_server.py ./

EXPOSE 8000

CMD ["uvicorn", "api_server:app", "--host", "0.0.0.0", "--port", "8000"]
