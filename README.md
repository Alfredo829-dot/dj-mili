# DJ Mili

Consola DJ en el navegador, pensada para el celular (Android + Chrome). Sin servidores, sin APIs de pago, sin instalar nada.

- Una sola pantalla de actuación: en vertical todo apilado; en horizontal, consola (A izquierda · mezcla/EQ al centro · B derecha, pads y música abajo). Botón ⛶ para pantalla completa y fijar horizontal.
- 2 decks con platos/jog que giran, medidores VU, perillas (Gain/Hi/Mid/Low/Filtro), BPM y tono automáticos (Camelot), 8 hot cues, loops al beat, sync, key lock (WSOLA)
- Forma de onda de colores, FX: echo al beat, flanger, freno de vinil y scratch
- Auto‑mix sincronizado al beat, cola y listas, sugerencias armónicas
- 16 pads (2 bancos): aplausos, risas, ovación, "oooh", "hey" (grabaciones reales CC0, ver `assets/pads/CREDITOS.md`) + air horn, sirena, rewind, scratch, impacto, subida, disparo FX, bass drop, platillo en reversa, láser, trompetas (sintetizados, CC0)
- EQ maestro de 10 bandas, limitador -1 dBFS, normalización de volumen por canción (-14 LUFS)
- Música del cel: elige canciones o videos de la galería una vez (mp3, m4a, aac, ogg, opus, wav, flac, mp4, webm…); quedan guardados (IndexedDB, almacenamiento persistente). Los videos suenan como audio por toda la cadena; opción de guardar solo el audio.
- Grabación de la mezcla a MP3 320/192 (LAME vía lamejs, LGPL), WAV y FLAC con metadatos; opcional WEBM/M4A comprimido
- YouTube: solo reproducir (sin EQ/FX/grabar)
- MIDI por USB‑OTG con aprendizaje, micrófono con eco, modo fiesta
- Bitácora {timestamp, usuario, acción, resultado} exportable y PIN local

Todo se guarda solo en el teléfono.
