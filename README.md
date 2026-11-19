# DJ Mili

Consola DJ en el navegador, pensada para el celular (Android + Chrome). Sin servidores, sin APIs de pago, sin instalar nada.

- Una sola pantalla de actuación: en vertical todo apilado; en horizontal, consola (A izquierda · mezcla/EQ al centro · B derecha, pads y música abajo). Botón ⛶ para pantalla completa y fijar horizontal.
- Búsqueda arriba de cada deck: escribe y toca para cargar en A o B, o «📱 Del cel» para elegir del teléfono directo a ese deck.
- 2 decks con platos/jog que giran, medidores VU, perillas (Gain/Hi/Mid/Low/Filtro), BPM y tono automáticos (Camelot), 8 hot cues, loops al beat, sync, key lock (WSOLA)
- Forma de onda de colores, FX: echo al beat, flanger, freno de vinil y scratch
- Auto‑mix sincronizado al beat, cola y listas, sugerencias armónicas
- Pads personalizables (hasta 64, bancos de 8): agrega pads desde audio o video del cel (se extrae el audio, nivel automático -14 LUFS), renombra, color, recorte inicio/fin, volumen, FX por pad, reordena, borra, «↺ Fábrica». De fábrica 16 pads: aplausos, risas, ovación, "oooh", "hey" (grabaciones reales CC0, ver `assets/pads/CREDITOS.md`) + air horn, sirena, rewind, scratch, impacto, subida, disparo FX, bass drop, platillo en reversa, láser, trompetas (sintetizados, CC0)
- EQ maestro de 10 bandas, limitador -1 dBFS, normalización de volumen por canción (-14 LUFS)
- Música del cel: elige canciones o videos de la galería una vez (mp3, m4a, aac, ogg, opus, wav, flac, mp4, webm…); quedan guardados (IndexedDB, almacenamiento persistente). Los videos suenan como audio por toda la cadena; opción de guardar solo el audio.
- 🎵 Reproductor normal (aparte de los decks): MP3/AAC/M4A/FLAC/WAV y videos MP4/WebM con imagen, lista, anterior/siguiente, aleatorio, repetir, barra de avance; controles en la pantalla de bloqueo (Media Session).
- «Envolvente»: estéreo más amplio (mid/side + Haas sutil + crossfeed para audífonos), compatible con mono, con perilla de cantidad; en el reproductor y opcional en la mezcla DJ. Todo pasa por el limitador.
- «Calidad HD»: pide salida a 48 kHz y procesa en float 32 bits; muestra la frecuencia real. La calidad depende del archivo: un MP3/AAC no mejora por subir la frecuencia.
- YouTube: solo reproducir (sin EQ/FX/grabar)
- MIDI por USB‑OTG con aprendizaje, micrófono con eco, modo fiesta
- Bitácora {timestamp, usuario, acción, resultado} exportable y PIN local

Todo se guarda solo en el teléfono.

## App Android (APK)

El workflow `.github/workflows/build-apk.yml` mete la app web dentro de un cascarón WebView (`android/`) y publica `dj-mili.apk` firmado en Releases: https://github.com/Alfredo829-dot/dj-mili/releases/latest/download/dj-mili.apk — funciona sin internet (YouTube sí necesita red). Selector de archivos del cel, micrófono, pantalla completa, pantalla siempre encendida, giro automático o horizontal fijo.

Pruebas automáticas en `tests/` (puppeteer + numpy).
