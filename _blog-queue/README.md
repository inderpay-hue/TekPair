# Cola de blog (publicación automática diaria)

Cada subcarpeta = 1 post listo para publicar, en orden alfabético (`001-…`, `002-…`).
El GitHub Action `blog-diario.yml` ejecuta cada día a las ~10:00 (España) `scripts/publicar-siguiente.js`,
que coge la carpeta **más baja**, publica sus 6 idiomas y la borra. Cola vacía = no hace nada.

## Estructura de cada item
```
_blog-queue/001-mi-tema/
  meta.json
  es.html  en.html  fr.html  it.html  de.html  pt.html   ← los 6 posts ya escritos y revisados
```

## meta.json
```json
{
  "date": "2026-06-05",
  "readtime": "8 min lectura",
  "category": "Gestión",
  "posts": {
    "es": { "dest":"blog/slug-es.html", "path":"/blog/slug-es.html",
            "url":"https://www.tekpair.tech/blog/slug-es.html",
            "title":"Título en español", "excerpt":"Resumen para la tarjeta del índice.",
            "dateLabel":"5 junio 2026", "readtime":"8 min lectura", "category":"Gestión",
            "readlink":"Leer guía completa →" },
    "en": { "dest":"blog/en/slug-en.html", "path":"/blog/en/slug-en.html",
            "url":"https://www.tekpair.tech/blog/en/slug-en.html",
            "title":"English title", "excerpt":"Card summary.", "readlink":"Read full guide →" }
    // … fr, it, de, pt
  }
}
```
- `dest` = ruta donde se copia el HTML. `url` = URL absoluta (para sitemap/hreflang). `path` = ruta relativa (para enlaces del índice).
- Cada HTML ya debe traer su SEO (title, description, canonical, los 6 hreflang + x-default, JSON-LD).
- **Sin afirmaciones falsas de Verifactu** (decir "próximamente").
