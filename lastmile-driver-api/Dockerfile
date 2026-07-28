FROM python:3.12-slim

WORKDIR /app

# tesseract-ocr-por: pacote de idioma português, obrigatório pra extração
# de DANFe fotografado (app.services.invoice_extraction_service.extract_from_photo)
# — sem ele o Tesseract não carrega nenhum idioma e falha em runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-por \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
