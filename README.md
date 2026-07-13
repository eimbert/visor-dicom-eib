# Visor DICOM EIB

Prototipo Angular del visor DICOM EIB.

## Funcionalidad Inicial

- Carga local de ficheros DICOM con selector o drag and drop.
- Render de imagenes DICOM con Cornerstone.
- Navegacion entre instancias.
- Herramientas basicas: window/level, pan, zoom, medicion, probe, invertir y reset.
- Tabla navegable de tags DICOM.
- Soporte inicial de ECG DICOM mediante `WaveformSequence`, renderizado en canvas.

## Siguientes Pasos

- Conectar con el backend Java para listar estudios recibidos.
- Servir DICOM desde endpoint seguro.
- Anadir thumbnails por serie.
- Definir campos editables y auditoria.
- Mejorar render ECG con calibracion real por sensibilidad/unidades.
- Preparar fase de anonimizacion.

## Desarrollo

```bash
npm install
npm start
```

Abrir `http://localhost:4200`.
