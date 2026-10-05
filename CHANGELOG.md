# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-05

### Fixed
- Align DSH peer dependencies with `0.2.0-rc.2` so the plugin installs on DSH `0.2.0-rc.2`.

## [0.1.0] - 2026-10-04

### Added
- Initial release of dsh-langfuse-plugin
- Event-based turn tracing through the native DSH Cordis plugin lifecycle
- OTLP/HTTP export to Langfuse with tool and generation observations
- Fail-open credential and network error handling
- Cordis configuration for Langfuse credentials and endpoint

[0.1.2]: https://github.com/sunshine0523/dsh-langfuse-plugin/releases/tag/v0.1.2
[0.1.0]: https://github.com/sunshine0523/dsh-langfuse-plugin/releases/tag/v0.1.0
