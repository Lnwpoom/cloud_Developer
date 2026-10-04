# BGP Hijack Monitor

Watches the BGP announcements for an operator's own address space and raises alerts when someone announces it in a way the RPKI or the operator's declarations don't support.

## Language

### Who and what is watched

**Operator**:
The network owner who runs the monitor to protect their own address space (e.g. a university or ISP network team).
_Avoid_: User, customer, admin

**Monitored prefix**:
An IP prefix the operator has declared as theirs and wants watched.
_Avoid_: Watched network, protected range

**Declared origin**:
The AS the operator states should originate a monitored prefix; the primary yardstick for raising alerts.
_Avoid_: Expected AS, owner AS, legitimate origin

### What is observed

**Announcement**:
A single BGP route advertisement seen on the feed: a prefix plus the AS path that carries it.
_Avoid_: Route update, advertisement, message

**Simulated announcement**:
An announcement fabricated on purpose (e.g. for a demo) and fed in alongside the live feed; it is always marked as simulated.
_Avoid_: Fake announcement, test data, injected route

**Origin AS**:
The last AS in an announcement's AS path, i.e. the AS claiming to originate the prefix.
_Avoid_: Source AS, owner AS

**Validation state**:
The RFC 6811 verdict for an announcement against the RPKI: Valid, Invalid or NotFound.
_Avoid_: ROV result, RPKI status

### What the monitor reports

**Alert**:
What the monitor emits when an announcement touching a monitored prefix looks wrong; it states only technical facts, never intent.
_Avoid_: Hijack, incident, alarm

**Alert kind**:
The technical fact an alert reports (e.g. origin does not match, more-specific announced).
_Avoid_: Alert type, severity

**Origin mismatch**:
An alert kind: a monitored prefix is announced with an origin AS other than its declared origin.
_Avoid_: Origin hijack, wrong AS

**Unexpected more-specific**:
An alert kind: a prefix strictly inside a monitored prefix is announced, and that prefix is not itself a monitored prefix — whatever its origin AS.
_Avoid_: Sub-prefix hijack, more-specific hijack

**Loose ROA**:
An alert kind: a ROA covering a monitored prefix allows a maxLength longer than the prefix itself, which lets a forged-origin more-specific validate as Valid.
_Avoid_: maxLength warning, ROA misconfiguration

**Hijack**:
A human judgement that an alert was a malicious or unauthorised announcement; the monitor never assigns it.
_Avoid_: Using it for any alert the monitor raises
