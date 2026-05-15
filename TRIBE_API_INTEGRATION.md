# Tribe API Integration Guide

## SDK Installation

**Local development** (current setup — uses local file path):
The SDK is referenced as `"file:../../api-shared"` in `package.json`. This works when running from the monorepo.

**Production / deployed tribes** — once the SDK is published to npm:
```bash
npm install @apicenter/sdk
```
Then update `package.json`:
```diff
- "@apicenter/sdk": "file:../../api-shared"
+ "@apicenter/sdk": "^1.0.0"
```
See `api-shared/PUBLISH.md` for full publish instructions (npm public or GitHub Packages).

---

This document explains how your Tribe Backend integrates with the `api-shared` SDK and the `api-center` Gateway. It also provides the exact step-by-step setup required to run this in production on Render.

## 1. How the Architecture Works

When a new API is added to the shared platform (e.g., a new email provider endpoint or a new Kafka topic), it gets added to the `@apicenter/sdk` inside the `api-shared` folder.

Because your backend repository (`template-repo-be`) pulls this SDK directly as a local dependency (`"file:../../api-shared"`), you get **instant access** and **autocomplete** to these new features. 

You **do not** need to update any boilerplate configuration in the backend when a new API is added. You just inject the client and use it.

## 2. Step-by-Step Render Setup

To deploy this backend connected to the API Center on Render, you must configure Render to build the shared SDK first, and provide the correct secure credentials.

### Step 2.1: Configure the Render Build Script
Render needs to build `api-shared` before building `template-repo-be`. We have provided a script for this.
1. Go to your **Render Dashboard** > **Web Service** > **Settings**.
2. Under **Build Command**, enter:
   ```bash
   chmod +x render-build.sh && ./render-build.sh
   ```
3. Under **Start Command**, enter:
   ```bash
   npm run start:prod
   ```

### Step 2.2: Provide the Tribe Credentials
Your backend needs to identify itself to the API Center to get an authentication token.
1. In your **Render Dashboard**, go to the **Environment** tab.
2. Add the following keys:
   * `API_CENTER_BASE_URL`: `https://<your-api-center-url>.onrender.com`
   * `API_CENTER_TRIBE_ID`: *(e.g., `tribe-payment`, given to you by the API Center admin)*
   * `API_CENTER_TRIBE_SECRET`: *(The secure secret key matching your Tribe ID)*

## 3. How Tribes Will Use This (Implementation Guide)

Since the `TribeClient` is provided via a **Global NestJS Module**, tribes can inject it into any Service or Controller without needing to import the module again.

### Example: Using an API or Kafka

Here is how a developer inside a Tribe will use the SDK to send an email and list Kafka topics.

```typescript
import { Injectable } from '@nestjs/common';
import { TribeClient } from '@apicenter/sdk';

@Injectable()
export class MyTribeFeatureService {
  constructor(
    // 1. Inject the TribeClient directly!
    private readonly tribeClient: TribeClient, 
  ) {}

  async doSomethingAwesome() {
    // 2. Use it for Shared APIS (e.g. Email)
    const emailResponse = await this.tribeClient.emailSend({
      to: 'user@example.com',
      subject: 'Welcome!',
      body: 'Hello from the tribe backend.'
    });

    // 3. Use it for Kafka!
    const topics = await this.tribeClient.kafkaListTopics('cluster-123');
    
    // 4. Use it for Payments!
    const checkout = await this.tribeClient.paymentCreateCheckoutSession({
      amount: 1000,
      currency: 'usd'
    });

    return { emailResponse, topics, checkout };
  }
}
```

### 4. Zero Maintenance for New APIs
When a backend engineer from another team updates `@apicenter/sdk` to support a new API (like `this.tribeClient.invoiceCreate()`), you simply pull the latest Git changes. The Render script will automatically build the new SDK, and the autocomplete in your IDE will instantly recognize `invoiceCreate()`.
