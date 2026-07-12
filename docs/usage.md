# Usage & API

It is a standard custom element, so it works with no wrapper in plain HTML, React, Vue, Svelte and Astro.

## Plain HTML

```html
<script src="qr-code.js"></script>
<qr-code-generator></qr-code-generator>
```

## React

```jsx
import "@sgbp/qr-code";
export default function Page() { return <qr-code-generator />; }
```

## Vue

```vue
<script setup>
import "@sgbp/qr-code";
</script>

<template>
  <qr-code-generator />
</template>
```

---

Prefer to just use it without installing anything? The
[live QR Code Generator](https://sgbp.tech/tools/qr-code-generator) is hosted and ready to go.
