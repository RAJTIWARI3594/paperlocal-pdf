# Third-party notices

All runtime libraries are bundled; no CDN fetch is required. Their original license files and license headers are retained.

| Component | Version | Use | License / bundled notice |
| --- | --- | --- | --- |
| pdf-lib | 1.17.1 | PDF parsing, page copying, image embedding and saving | MIT, `vendor/pdf-lib-LICENSE.md` |
| pdfjs-dist (Mozilla PDF.js) | 5.4.296 | Browser page previews and worker | Apache-2.0, `vendor/pdfjs-LICENSE`; original headers retained in JS |
| PDF.js standard fonts | From pdfjs-dist 5.4.296 | Standard-font previews | `vendor/standard_fonts/LICENSE_FOXIT`, `LICENSE_LIBERATION` |

The pdf-lib distribution also contains @pdf-lib/standard-fonts 1.0.0, @pdf-lib/upng 1.0.1, pako 1.0.11 and TypeScript tslib 1.11.1 code according to its upstream lockfile. Original dependency notices are retained in `vendor/dependency-licenses/`; they include MIT, zlib and Apache notices.

Pinned upstream packages were obtained from the npm registry. Bundled files: pdf-lib's `dist/pdf-lib.esm.min.js`; PDF.js `build/pdf.mjs`, `build/pdf.worker.min.mjs`, and `standard_fonts/`. CMaps, wasm codecs and source maps are not bundled; unusual preview formats may be unsupported. Do not remove third-party copyright notices when redistributing.

Development-only tests use Playwright 1.55.0 (Apache-2.0), Pillow 11.3.0 (HPND) and pypdf 6.1.1 (BSD-3-Clause), installed by uv from the inline test script metadata. They are not bundled runtime code. Node's built-in test runner supplies the core tests. Prettier 3.6.2 was used to format source during development, not added as a runtime dependency.
