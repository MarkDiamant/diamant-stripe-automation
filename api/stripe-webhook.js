const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const MONTHLY_PRICE_ID = 'price_1UAWSTKCFlu3cFvBSgdTyXDa';

async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(
      rawBody,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.created') {
      const eventSubscription = event.data.object;
      const isMonthlyWebsitePlan = eventSubscription.items?.data?.some(
        (item) => item.price?.id === MONTHLY_PRICE_ID
      );

      if (isMonthlyWebsitePlan) {
        // Retrieve fresh state so a retried webhook cannot create a second schedule.
        const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);

        if (!subscription.schedule) {
          const schedule = await stripe.subscriptionSchedules.create(
            { from_subscription: subscription.id },
            { idempotencyKey: `website-minimum-${subscription.id}` }
          );

          const phase = schedule.phases[0];
          const phaseItems = phase.items.map((item) => ({
            price: typeof item.price === 'string' ? item.price : item.price.id,
            quantity: item.quantity || 1,
          }));

          await stripe.subscriptionSchedules.update(schedule.id, {
            end_behavior: 'release',
            phases: [
              {
                start_date: phase.start_date,
                iterations: 12,
                items: phaseItems,
              },
            ],
            metadata: {
              purpose: 'diamant_website_12_month_minimum',
              source_subscription: subscription.id,
            },
          });

          console.log(`Applied 12-month minimum schedule ${schedule.id} to ${subscription.id}`);
        } else {
          console.log(`Subscription ${subscription.id} already has schedule ${subscription.schedule}`);
        }
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe automation failed:', err);
    return res.status(500).json({ error: 'Stripe automation failed' });
  }
};
