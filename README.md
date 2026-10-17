# keymidi

A Simple Keyboard MIDI Controller

Install [node.js](https://nodejs.org/) then 

```console
npm install node-hid
npm install easymidi
node clavione.js
```

## aclav.js: rodando sem sudo

`aclav.js` acessa o controlador USB HID (vendor `0x8089`, product `0x0008`) via
`node-hid`. Por padrão, `/dev/hidraw*` só é acessível por root, então sem uma
regra udev é preciso rodar com `sudo node aclav.js`.

Para liberar o acesso ao usuário da sessão ativa (sem precisar de sudo depois),
crie a regra udev abaixo e recarregue as regras:

```console
sudo cp 72-keymidi.rules /etc/udev/rules.d/72-keymidi.rules
sudo udevadm control --reload-rules
sudo udevadm trigger
```

O número `72` importa: as regras do systemd-logind (`73-seat-late.rules`) são
as que de fato aplicam a ACL do `uaccess` quando veem essa tag. Se a regra do
keymidi tiver um número maior (ex.: `99-...`), ela roda *depois* de
`73-seat-late.rules` e a tag chega tarde demais — o dispositivo fica marcado
com `uaccess`, mas a ACL nunca é aplicada.

Depois, desconecte e reconecte o controlador USB (a regra só se aplica quando
o dispositivo é redetectado). A partir daí, `node aclav.js` funciona sem sudo.

Conteúdo de `72-keymidi.rules`:

```
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="8089", ATTRS{idProduct}=="0008", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="8089", ATTRS{idProduct}=="0009", TAG+="uaccess"
```

A segunda linha libera o SayoDevice O3C (product `0x0009`), usado pelo
`aclav.js` como controle extra: o dial ajusta a velocity das notas (o botão do
dial volta para 100) e os três botões tocam F, Gb e G graves.
