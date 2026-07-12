# QR Code Generator

A QR code generator: turn any URL or text into a scannable QR code and download it as PNG, all in the browser. Zero dependencies — works in plain HTML, React, Vue, Svelte or Astro.

**▶ [Live demo](https://sgbp.tech/tools/qr-code-generator)**

```html
<script src="qr-code.js"></script>
<qr-code-generator></qr-code-generator>
```

## What it does

The tool encodes your text to the QR specification with Reed-Solomon error correction (level M), so the code scans reliably even with minor print wear. Everything runs in the browser, so whatever you encode never leaves your device.

## Install

```bash
npm install @sgbp/qr-code
```

or copy `qr-code.js` into your project.

## Further reading

Maintained by [SGBP — Singapore Build Partners](https://sgbp.tech), a studio building fast,
accessible websites for Singapore SMEs, as one of a set of free developer tools.

## License

MIT © SGBP. Contributions welcome.
