import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function loadEnvFallback(): Record<string, string> {
  const vars: Record<string, string> = {};
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "frontend", ".env"),
    path.resolve(process.cwd(), "frontend", ".env.local"),
  ];
  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const k = trimmed.slice(0, eq).trim();
        let v = trimmed.slice(eq + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in vars)) vars[k] = v;
      }
    } catch {
      // Ignore unreadable env candidates
    }
  }
  return vars;
}

function getPayPalConfig() {
  const fileEnv = loadEnvFallback();
  const clientId = process.env.PAYPAL_CLIENT_ID || fileEnv.PAYPAL_CLIENT_ID || "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || fileEnv.PAYPAL_CLIENT_SECRET || "";
  const baseUrl = (
    process.env.PAYPAL_BASE_URL ||
    fileEnv.PAYPAL_BASE_URL ||
    "https://api-m.sandbox.paypal.com"
  ).replace(/\/+$/, "");

  if (!baseUrl.includes("sandbox.paypal.com")) {
    throw new Error("Sandbox helper only permits sandbox.paypal.com endpoints.");
  }
  if (!clientId || !clientSecret) {
    throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in environment.");
  }
  return { clientId, clientSecret, baseUrl };
}

async function getAccessToken(baseUrl: string, clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `PayPal OAuth failed (${res.status})`);
  }
  return data.access_token as string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      order_id?: string;
      amount_usd?: number | string;
    };
    const { clientId, clientSecret, baseUrl } = getPayPalConfig();
    const token = await getAccessToken(baseUrl, clientId, clientSecret);

    if (body.action === "capture" && body.order_id) {
      const orderId = body.order_id.trim();
      const capRes = await fetch(
        `${baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      const capData = await capRes.json();
      if (!capRes.ok) {
        return Response.json(
          {
            error: "PAYPAL_CAPTURE_FAILED",
            message: capData?.details?.[0]?.description || capData?.message || `HTTP ${capRes.status}`,
          },
          { status: capRes.status }
        );
      }
      const captureId =
        capData?.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";
      return Response.json({
        order_id: capData?.id || orderId,
        capture_id: captureId,
        status: capData?.status || "COMPLETED",
      });
    }

    const parsed = Number(body.amount_usd);
    const amountValue = Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(2) : "38.00";
    const origin = (request.headers.get("origin") || request.nextUrl.origin || "http://localhost:3000").replace(/\/+$/, "");

    const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: amountValue,
            },
          },
        ],
        application_context: {
          return_url: `${origin}/sandbox?paypal_approved=1`,
          cancel_url: `${origin}/sandbox?paypal_cancelled=1`,
          user_action: "PAY_NOW",
        },
      }),
    });
    const orderData = await orderRes.json();
    if (!orderRes.ok || !orderData?.id) {
      return Response.json(
        {
          error: "PAYPAL_ORDER_CREATE_FAILED",
          message: orderData?.details?.[0]?.description || orderData?.message || `HTTP ${orderRes.status}`,
        },
        { status: orderRes.status || 500 }
      );
    }

    const approveUrl =
      (orderData.links as Array<{ rel?: string; href?: string }> | undefined)?.find(
        (l) => l.rel === "approve"
      )?.href || "";

    return Response.json({
      order_id: orderData.id,
      status: orderData.status || "CREATED",
      approve_url: approveUrl,
      amount_usd: amountValue,
    });
  } catch (err) {
    return Response.json(
      {
        error: "PAYPAL_SANDBOX_HELPER_ERROR",
        message: err instanceof Error ? err.message : "Failed to create PayPal Sandbox order",
      },
      { status: 500 }
    );
  }
}
