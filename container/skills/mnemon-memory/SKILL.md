---
name: mnemon-memory
description: Usar mnemon como memoria de grafo para recordar contexto relevante antes de trabajar y guardar hechos duraderos despues.
---

# Mnemon Memory

`mnemon` esta instalado en el contenedor. Su directorio de datos es:

```bash
$MNEMON_DATA_DIR
```

Usalo como memoria de grafo duradera:

```bash
mnemon status
mnemon recall "que contexto necesito?"
mnemon remember "hecho duradero, preferencia, decision o flujo de trabajo"
```

Recuerda contexto antes de tareas que dependan de informacion pasada. Guarda
solo hechos duraderos: preferencias del usuario, decisiones estables del
proyecto, flujos recurrentes, nombres, restricciones y aprendizajes. No guardes
secretos ni detalles temporales.
