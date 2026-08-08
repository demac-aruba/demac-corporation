# DEMAC WhatsApp AI Copilot — Architecture V30

## Why V30 exists

V18–V22 accumulated deterministic conversation routers around a real OpenAI integration. Those guards improved individual edge cases but progressively moved conversational interpretation away from the model and into regular expressions, canned replies and state-machine branches. The result could feel scripted even though OpenAI was connected.

V30 changes the boundary: **OpenAI interprets the conversation first; the ERP remains authoritative for facts and actions.**

## Production flow

1. The Chrome extension reads the visible WhatsApp conversation and sends it to Firebase.
2. Firebase passes the conversation to OpenAI as native `user` and `assistant` messages, not as one JSON transcript string.
3. The primary model is `gpt-5.1` with medium reasoning. `gpt-5-mini` is a compatibility fallback if the API project cannot use the primary model.
4. OpenAI must call one strict planning function, `decide_customer_turn`, which returns the semantic next action and structured facts.
5. The backend executes only authoritative tools:
   - normal conversational reply;
   - ERP availability lookup;
   - ERP appointment booking;
   - ERP/company knowledge lookup;
   - human handoff.
6. Availability, route feasibility, van capacity, service durations, prices and the actual booking transaction are never invented by the model.
7. The final metadata records the actual model, whether fallback was used, agent version and architecture for debugging.

## Conversation principles

- The latest customer turn is the immediate task; prior turns provide context.
- Short replies such as `sí`, `esa`, `en la tarde`, `la primera` are interpreted in relation to the immediately preceding conversation.
- A clear confirmation of a single offered appointment advances to booking; it does not reopen availability.
- Missing information is collected progressively, with one useful question at a time whenever possible.
- The assistant avoids repeating `Perfecto` and avoids repeating facts already established.
- Customer-facing replies never mention OpenAI, prompts, databases, ERP internals or routing algorithms.
- Spanish, English and Papiamento di Aruba are supported.

## Safety boundary

The model may interpret language, but it cannot create an appointment slot, price, duration or route by itself. Those values come from the ERP. A booking is executed only through the ERP scheduling transaction after the customer has selected/confirmed an offered option.

## Runtime compatibility

The public `conversationPolicyVersion` stays at 18 so extension v0.5.0 can continue connecting without reinstalling. `conversationFlowVersion` and `agentVersion` are 30 and identify the AI-first architecture.
