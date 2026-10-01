# Guía de uso · Dashboard KPIs Balderrama

## Entregables

| Archivo | Descripción |
|---|---|
| `Guia-uso-Balderrama-KPIs.pdf` | PDF listo para entregar |
| `guia-uso-balderrama.html` | Versión HTML imprimible (fuente del PDF) |
| `guia-imagenes/` | Capturas e ilustraciones del manual |
| `build-guia.js` | Regenera el HTML desde el catálogo ABP |

## Regenerar

```powershell
node docs/build-guia.js
# Luego abrir el HTML en Chrome → Ctrl+P → Guardar como PDF
# o:
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --print-to-pdf="$PWD\docs\Guia-uso-Balderrama-KPIs.pdf" "file:///$PWD/docs/guia-uso-balderrama.html"
```

## Contenido del manual

1. Acceso y modos de usuario (5 roles)
2. Matriz de perfiles / secciones
3. Uso de cada módulo
4. Seguimiento 360 · acompañamiento por cliente/VIN (retención taller FEM + recompra Seminuevos/equity)
5. Resumen personalizable (8 espacios)
6. Alertas inteligentes + semáforo + agente IA
7. Notificaciones y seguimientos
8. 23 KPIs del resumen + 47 del Mapa ABP 2026
9. Tipos de alertas operativas
