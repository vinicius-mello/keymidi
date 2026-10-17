# Patches do Surge XT

Patches que imitam instrumentos acústicos, gerados por `build_patches.py`
(a partir do template "Init Karplus-Strong" do próprio Surge XT 1.3).
Para regenerar após editar os parâmetros: `python3 patches/build_patches.py`.

| Patch | Síntese | Controles |
|---|---|---|
| English Concertina | Oscilador Modern (pulso quase quadrado + serra) → LP24 fixo (~3 kHz) e EQ fixo imitando a câmara das palhetas (formante em ~1,35 kHz, fundamental grave atenuada); brilho cresce com o ataque (~40 ms); leve oscilação do fole (Scene LFO 1). Calibrado contra gravações de Stuart Eydmann (archive.org/raretunes) | Mod wheel / breath (CC2) = pressão do fole (mais volume e brilho) |
| Theorbo | Karplus-Strong: rajada curta de ruído escuro → filtro comb afinado na nota → LP com envelope | Velocity = brilho; pedal de sustentação deixa as cordas soarem |
| Renaissance Lute | Igual à tiorba, mais brilhante e com ordens duplas: cenas A e B em camada, desafinadas ±2 cents e abertas no estéreo | Idem |

Todos usam **Reverb 2 no Send FX 1** (concertina: sala, 1,7 s; tiorba: igreja,
2,8 s; alaúde: 2,2 s). A quantidade de reverb é o knob "FX Send 1" da cena.

`demos/` tem uma gravação curta de cada patch.

Para aparecerem no navegador de patches do Surge, copie os `.fxp` para a pasta
de dados do usuário (Menu > Data Folders > Open User Data Folder), ou abra-os
direto com Menu > Open Patch / `surge-xt-cli --init-patch=...`.
