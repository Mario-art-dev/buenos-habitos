# Estudia

Convierte tus apuntes en **5 vídeos de unos 2 minutos**, en inglés, estilo Draw My Life: pizarra blanca,
mano que dibuja con rotuladores de colores, muñeco que explica, ejemplos, voz y preguntas para tocar.

## Qué incluye
- **Para ti**: todos los vídeos mezclados, sin repetir hasta haberlos visto todos.
- **Secciones**: un vídeo por asignatura y tema.
- **Crear**: subes PDF, Word, texto o fotos de apuntes. El temario se divide en 5 partes iguales y se crea un vídeo por parte.
- **Buscar**: busca por palabra.
- **Ajustes**: claves de los proveedores de IA (Gemini, Groq, Cerebras, Mistral, Anthropic, OpenAI u Ollama).

## Arrancarlo en GitHub
1. Pestaña **Actions** → **Servidor temporal** → **Run workflow**.
2. Al terminar, en el resumen aparece la URL pública.
3. Entra con la contraseña del secreto `APP_PASSWORD`.

La base de datos se guarda cada 20 minutos en la rama `study-data`.

## Desarrollo
```bash
npm install
cp .env.example .env   # pon APP_PASSWORD, SESSION_SECRET y DATABASE_URL="file:./storage/app.db"
npx prisma db push
npm run dev
```
