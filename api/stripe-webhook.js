const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const MONTHLY_PRICE_ID = 'price_1UAWSTKCFlu3cFvBSgdTyXDa';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'customer.subscription.created') {
      const subscription = event.data.object;
      const isMonthlyWebsitePlan = subscription.items?.data?.some(
        (item) => item.price?.id === MONTHLY_PRICE_ID
      );

      if (isMonthlyWebsitePlan && !subscription.schedule) {
        const schedule = await stripe.subscriptionSchedules.create({
          from_subscription: subscription.id,
        });

        const phase = schedule.phases[0];
        await stripe.subscriptionSchedules.update(schedule.id, {
          end_behavior: 'release',
          phases: [
            {
              start_date: phase.start_date,
              end_date: phase.end_date,
              items: phase.items.map((item) => ({
                price: item.price,
                quantity: item.quantity || 1,
              })),
            },
            {
              iterations: 11,
              items: phase.items.map((item) => ({
                price: item.price,
                quantity: item.quantity || 1,
              })),
            },
          ],
          metadata: {
            purpose: 'diamant_website_12_month_minimum',
            source_subscription: subscription.id,
          },
        });
        console.log(`Applied 12-month minimum schedule ${schedule.id} to ${subscription.id}`);
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Stripe automation failed:', err);
    return res.status(500).json({ error: 'Stripe automation failed' });
  }
};

module.exports.config = { api: { bodyParser: false } };
