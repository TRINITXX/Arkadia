# Arkadia

Application terminal Windows native, Rust + Tauri 2 + WebGPU.



## Stack

- Tauri 2 (Rust core + WebView2)
- React + TypeScript + Vite
- Tailwind v4
- shadcn/ui (à installer après bootstrap)
- termwiz (parser terminal, référence WezTerm)
- portable-pty (ConPTY)
- Renderer terminal : crate `terminal-renderer` (Rust → WASM, WebGPU)

## Dev

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

Sortie : `src-tauri/target/release/arkadia.exe` + `src-tauri/target/release/bundle/msi/Arkadia_0.1.0_x64_en-US.msi`.
