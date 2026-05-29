# Pre-Visit Agent — Bug Report
**Area:** Pre-Visit Agent  
**Environment:** staging — `api.stg.elfie.co`  
**Auth:** `x-api-key` header  
**Test type:** API  
**Date:** 2026-05-26  
**Tool:** `reproduce-lang-mix.js` — 10 parallel sessions per batch (5 FR + 5 VI), 10 batches = 100 total sessions

---

## Bug — Bot replies in the wrong language mid-conversation when sessions in different languages run at the same time

**Severity:** High  
**Reproduced:** 3 out of 50 French sessions received a Vietnamese reply (6%)  
**All contaminated sessions:** French sessions that received a Vietnamese response

### What was tested

We ran French and Vietnamese sessions at the same time — 10 sessions in parallel per batch. Each session used `language_code` set correctly in every request. We tested 100 sessions total (50 French, 50 Vietnamese).

3 French sessions replied correctly in French on the first message, then switched to Vietnamese on the very next message. No Vietnamese session received a French reply.

---

## Contaminated session 1 — sessionId 7849

### Create session

```json
POST /agent/api/v1/ai-coach/create-session
Request:
{
  "user_id": "lang-test",
  "language_code": "fr",
  "config": {
    "domains": ["Visit Context"],
    "doctor_language_code": "fr"
  }
}

Response 200:
{
  "sessionId": 7849
}
```

### Turn 1 — Init (correct French ✓)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7849,
  "message": "start conversation",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7849,
  "sender": "AI",
  "message": "Bonjour ! Je suis ravi de vous accompagner... Pourriez-vous me donner votre prénom ?"
}
```

### Turn 2 — Send name (wrong language — Vietnamese ✗)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7849,
  "message": "Test User",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7849,
  "sender": "AI",
  "message": "Rất vui được gặp bạn, Test User. Để giúp đội ngũ y tế hiểu rõ hơn về tình trạng của bạn, bạn có thể cho tôi biết giới tính của mình là gì không?"
}
```

---

## Contaminated session 2 — sessionId 7851

### Create session

```json
POST /agent/api/v1/ai-coach/create-session
Request:
{
  "user_id": "lang-test",
  "language_code": "fr",
  "config": {
    "domains": ["Visit Context"],
    "doctor_language_code": "fr"
  }
}

Response 200:
{
  "sessionId": 7851
}
```

### Turn 1 — Init (correct French ✓)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7851,
  "message": "start conversation",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7851,
  "sender": "AI",
  "message": "C'est un plaisir de vous rencontrer. Pourriez-vous me donner votre prénom ?"
}
```

### Turn 2 — Send name (wrong language — Vietnamese ✗)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7851,
  "message": "Test User",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7851,
  "sender": "AI",
  "message": "Rất vui được gặp bạn, Test User. Để giúp đội ngũ y tế hiểu rõ hơn về tình trạng của bạn, bạn có thể cho tôi biết giới tính của mình là gì không?"
}
```

---

## Contaminated session 3 — sessionId 7857

### Create session

```json
POST /agent/api/v1/ai-coach/create-session
Request:
{
  "user_id": "lang-test",
  "language_code": "fr",
  "config": {
    "domains": ["Visit Context"],
    "doctor_language_code": "fr"
  }
}

Response 200:
{
  "sessionId": 7857
}
```

### Turn 1 — Init (correct French ✓)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7857,
  "message": "start conversation",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7857,
  "sender": "AI",
  "message": "Bonjour ! Je suis ravi de vous accompagner... Pourriez-vous me donner votre prénom ?"
}
```

### Turn 2 — Send name (wrong language — Vietnamese ✗)

```json
POST /agent/api/v1/ai-coach/chat
Request:
{
  "session_id": 7857,
  "message": "Test User",
  "language_code": "fr"
}

Response 200:
{
  "sessionId": 7857,
  "sender": "AI",
  "message": "Rất vui được gặp bạn, Test User. Để giúp đội ngũ y tế hiểu rõ hơn về tình trạng de bạn, bạn có thể cho tôi biết giới tính của mình là gì không?"
}
```

---

## What actually happened

All 3 contaminated sessions follow the same pattern:

1. Session created with `language_code: "fr"` — response is `{ "sessionId": XXXX }`
2. First chat message — bot replies correctly in French
3. Second chat message — bot switches to Vietnamese

The `language_code: "fr"` is sent correctly in every request. The session starts in French and then changes language mid-conversation. This only happened on French sessions, and only when Vietnamese sessions were running at the same time.

## What we expected

Each session should always reply in the language it was created with. If a session was created with `language_code: "fr"`, every reply in that session should be in French — regardless of what other sessions are running at the same time.

## Reproduction rate

| Total sessions tested | Contaminated | Rate |
|---|---|---|
| 50 French sessions | 3 wrong language | 6% |
| 50 Vietnamese sessions | 0 wrong language | 0% |

Contamination always went in one direction: French sessions received Vietnamese replies. No Vietnamese session received a French reply.

## When it happens

The contamination only occurs when French and Vietnamese sessions are running at the same time (parallel). Sequential sessions (one language at a time) showed no contamination. This points to a race condition in how the server stores or reads the language setting for a session when multiple sessions are being processed simultaneously.
