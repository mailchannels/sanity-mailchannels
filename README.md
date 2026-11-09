# MailChannels notifications for Sanity

Two [Sanity Functions](https://www.sanity.io/docs/functions) that email your editorial team through the
[MailChannels Email API](https://docs.mailchannels.com/):

- **mailchannels-published** runs when a document of a chosen type is published.
- **mailchannels-review-requested** runs when a draft's status field changes to your "ready for review" value.

Each email names the document (ID, type, revision) and links to your Studio. Document content never
leaves Sanity: the Functions send only the document's identity to the MailChannels integration service,
which stores it and sends one email. Repeated events for the same revision are recognised and not sent twice.

## Before you start

- A Sanity project and dataset, and the [Sanity CLI](https://www.sanity.io/docs/cli) (`npx sanity@latest`).
- Node.js 22.18 or later.
- A MailChannels Email API account: your account ID and an API key with send permission.
- A sender domain with a MailChannels [Domain Lockdown](https://docs.mailchannels.com/email-api/domain-lockdown)
  record (`_mailchannels.<your domain>` TXT `v=mc1 auth=<your account ID>`).

## 1. Create a MailChannels connection

The connection holds your API key and decides who receives each email. Event data can never change the
sender, recipients, subject or Studio link.

```sh
curl -sS https://integrations.mailchannels.net/sanity/v1/connections \
  -H 'Content-Type: application/json' \
  -d '{
    "account_id": "<MailChannels account ID>",
    "api_key": "<MailChannels API key>",
    "project_id": "<Sanity project ID>",
    "dataset": "production",
    "document_types": ["post"],
    "routes": [
      {"revision": "publish-v1", "from": "cms@example.com", "recipients": ["editors@example.com"],
       "subject": "Document published", "studio_url": "https://example.sanity.studio/"},
      {"revision": "review-v1", "from": "cms@example.com", "recipients": ["reviewers@example.com"],
       "subject": "Review requested", "studio_url": "https://example.sanity.studio/"}
    ]
  }'
```

The answer contains `events_url` and `token`. **The token is shown only once**; keep it with your other secrets.

To change recipients or document types later, `PUT` new settings to
`https://integrations.mailchannels.net/sanity/v1/connections/<connection>` with
`Authorization: Bearer <token>`. Add a new route revision rather than editing one that queued emails may
still use. `DELETE` the same URL to disconnect; queued emails are dropped and the API key is forgotten.

## 2. Configure the Functions

Copy `config.example.json` and fill in your project, dataset, document types and the route revisions from
step 1. The review Function watches `statusField` on drafts and runs when it becomes `readyValue`.

```json
{
  "published": {"projectId": "abc123", "dataset": "production", "documentTypes": ["post"], "routingRevision": "publish-v1"},
  "review": {"projectId": "abc123", "dataset": "production", "documentTypes": ["post"], "routingRevision": "review-v1",
             "statusField": "editorialStatus", "readyValue": "ready"}
}
```

This file holds no secrets. Both Functions must use the same project and dataset and different revisions.

## 3. Deploy

```sh
npm ci
export SANITY_EMAIL_CONFIG="$(cat config.json)"
npx sanity@latest blueprints config --edit --project-id <Sanity project ID>
npx sanity@latest blueprints plan
npx sanity@latest blueprints deploy
```

Then give both Functions their settings and the connection secret. Variables can only be added after the
first deploy, and they take effect on the next invocation:

```sh
for f in mailchannels-published mailchannels-review-requested; do
  npx sanity@latest functions env add $f SANITY_EMAIL_CONFIG "$SANITY_EMAIL_CONFIG"
  npx sanity@latest functions env add $f SANITY_EMAIL_INTAKE_URL "<events_url>"
  npx sanity@latest functions env add $f SANITY_EMAIL_INTAKE_TOKEN "<token>"
done
```

Publish a document of a configured type to test it, and check `npx sanity@latest functions logs mailchannels-published`.
Never put the token in `sanity.config`, Studio environment variables or documents.

## Behaviour and limits

- The published Function ignores drafts and release versions; the review Function only looks at drafts.
- If the integration service does not confirm it stored the event, the invocation fails, so Sanity can retry
  it. A retry of a stored event is recognised and not sent again.
- MailChannels accepting a message is not proof of inbox delivery.

## Development

```sh
npm ci
npm run check   # TypeScript
npm test        # unit tests, no network
```

## Support

Email [dev@mailchannels.com](mailto:dev@mailchannels.com). Licensed under the MIT License.
