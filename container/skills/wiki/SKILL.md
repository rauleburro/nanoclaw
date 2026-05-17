---
name: wiki
description: Mantener una base de conocimiento markdown persistente desde fuentes crudas. Usar al ingerir documentos, responder desde la wiki o revisar la salud de la wiki.
---

# Wiki

Usa la wiki del grupo como una base de conocimiento sintetizada, no como una
pila de notas sueltas.

La wiki tiene tres capas:

- `sources/`: material fuente crudo. Trata estos archivos como inmutables salvo
  que Raul pida reorganizarlos.
- `wiki/`: paginas markdown sintetizadas por el agente.
- `CLAUDE.local.md`: esquema y reglas operativas para la wiki de este agente.

Operaciones principales:

- **Ingesta**: lee una fuente por vez, resume los hallazgos, y luego actualiza
  todas las paginas wiki afectadas, `wiki/index.md` y `wiki/log.md`.
- **Consulta**: lee primero `wiki/index.md`, inspecciona las paginas relevantes,
  responde con enlaces/citas a paginas wiki o fuentes, y ofrece guardar las
  respuestas utiles en la wiki.
- **Revision**: busca contradicciones, paginas obsoletas, paginas huerfanas,
  enlaces faltantes y material fuente que aun no fue integrado.

Reglas:

- Nunca ingieras una carpeta entera leyendo todo por encima. Termina una fuente
  completamente antes de empezar la siguiente.
- Prefiere paginas pequenas y bien enlazadas antes que un documento gigante.
- Manten `wiki/log.md` como append-only con encabezados del tipo
  `## [YYYY-MM-DD] operacion | titulo`.
- Usa enlaces de Obsidian cuando ayuden: `[[Nombre de Pagina]]`.
