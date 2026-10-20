# Share host device discovery in a dedicated package

Host device discovery belongs to `@fliwright/devices`, a standalone Node package
without a dependency on core, TDD, CLI or cloud. CLI and cloud consume its public
interface; future editor consumers can do the same. This keeps native Android/Xcode
tool details and normalized device states together without coupling detection to an
app connection or to team scheduling. This choice was explicitly requested on
2026-10-19 rather than initially housing discovery in core.

`DeviceDiscovery.scan()` returns a host inventory with normalized platform, device
kind, connection/lifecycle state and per-source diagnostics. Missing tools preserve
results from other sources; cancellation rejects. Detection does not boot, erase,
pair, unlock or launch apps. iOS support uses Xcode on macOS; Android uses SDK tools.

The cloud Worker scans and reports independently of execution leases. The server
stores the latest inventory under the authenticated Worker identity and uses its
own receipt time to mark stale snapshots. Discovery never creates slots or makes a
quarantined slot idle. Worker health, physical device state and execution-slot state
remain distinct. Device scheduling and reset policy remain explicit deployment choices.
