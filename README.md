# Visor DICOM EIB

Prototipo Angular del visor DICOM EIB.

## Funcionalidad Inicial

- Carga local de ficheros DICOM con selector o drag and drop.
- Render de imagenes DICOM con Cornerstone.
- Navegacion entre instancias.
- Herramientas basicas: window/level, pan, zoom, medicion, probe, invertir y reset.
- Tabla navegable de tags DICOM.
- Soporte inicial de ECG DICOM mediante `WaveformSequence`, renderizado en canvas.
- Solicitud de una opinion IA experimental sobre una unica imagen o ECG seleccionado.

## Opinion IA Experimental

El boton `Opinion IA` abre un dialogo con una pregunta clinica y envia al backend unicamente el canvas renderizado como PNG. No se envia el DICOM original, sus tags ni los overlays HTML con datos del paciente.

Antes del envio el usuario debe confirmar visualmente que no hay identificadores grabados dentro de los pixeles. El backend tambien bloquea instancias cuyo tag `BurnedInAnnotation` indique `YES`.

La URL base del backend se configura por entorno:

- Desarrollo: `src/environments/environment.ts`.
- Produccion: `src/environments/environment.prod.ts`.

Propiedad utilizada:

```typescript
aiApiBaseUrl: 'http://localhost:8080/ServidorDicomFHES'
```

El endpoint final se construye como `${aiApiBaseUrl}/ai/opinion`.

La respuesta es una observacion preliminar sin valor diagnostico hasta su revision por un facultativo. En esta fase no existe memoria de casos, analisis de series completas ni almacenamiento de respuestas.

## Continuidad Desde Otro PC

1. Ejecutar `git pull`.
2. Revisar `src/environments/` y ajustar `aiApiBaseUrl` al backend del entorno.
3. Ejecutar `npm install` y `npm start`.
4. Levantar `servidorDICOM` con `OPENAI_API_KEY` configurada como variable de entorno.
5. Cargar una imagen o ECG, abrir `Opinion IA`, confirmar la revision visual y realizar la consulta.

La clave de OpenAI nunca debe introducirse en este repositorio ni enviarse desde Angular.

## Siguientes Pasos

- Conectar con el backend Java para listar estudios recibidos.
- Servir DICOM desde endpoint seguro.
- Anadir thumbnails por serie.
- Definir campos editables y auditoria.
- Mejorar render ECG con calibracion real por sensibilidad/unidades.
- Incorporar deteccion OCR de texto quemado para reforzar la anonimizacion.
- Sustituir la confirmacion manual por un pipeline de validacion de anonimato cuando este disponible.

## Desarrollo

```bash
npm install
npm start
```

Abrir `http://localhost:4200`.
