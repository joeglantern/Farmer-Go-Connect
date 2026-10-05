import type { Language } from '@farmgo/contracts';

/**
 * Notification copy in English and Kiswahili. SMS uses `sms` when present (kept under 160
 * characters), otherwise `body`. Variables are filled with {{name}} placeholders.
 */
export type TemplateKey =
  | 'otp'
  | 'welcome_farmer'
  | 'match_proposed_buyer'
  | 'match_proposed_farmer'
  | 'match_accepted'
  | 'order_new_farmer'
  | 'order_confirmed'
  | 'order_ready_for_qa'
  | 'order_qa_passed'
  | 'order_qa_rejected'
  | 'order_in_transit'
  | 'order_delivered_buyer'
  | 'order_delivered_farmer'
  | 'order_cancelled'
  | 'order_message'
  | 'demand_digest'
  | 'payment_success'
  | 'payment_failed'
  | 'payout_success'
  | 'payout_failed_admin'
  | 'route_assigned'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'input_order_new'
  | 'input_order_status'
  | 'crate_return_reminder'
  | 'harvest_reminder';

interface Copy {
  title: string;
  body: string;
  sms?: string;
}

const T: Record<TemplateKey, Record<Language, Copy>> = {
  otp: {
    en: {
      title: 'Your code',
      body: 'Your FarmGo code is {{code}}. It expires in 5 minutes. Do not share it.',
    },
    sw: {
      title: 'Nambari yako',
      body: 'Nambari yako ya FarmGo ni {{code}}. Itaisha baada ya dakika 5. Usimpe mtu.',
    },
  },
  welcome_farmer: {
    en: {
      title: 'Welcome to FarmGo',
      body: 'Welcome {{name}}! You can now sell to hotels. Dial {{ussd}} or open the app to list produce.',
    },
    sw: {
      title: 'Karibu FarmGo',
      body: 'Karibu {{name}}! Sasa unaweza kuuza kwa hoteli. Piga {{ussd}} au fungua programu kuorodhesha mazao.',
    },
  },
  match_proposed_buyer: {
    en: {
      title: 'Supply found',
      body: '{{qty}} {{unit}} of {{produce}} available for your {{date}} request. Review and accept.',
    },
    sw: {
      title: 'Mazao yamepatikana',
      body: '{{qty}} {{unit}} za {{produce}} zinapatikana kwa ombi lako la {{date}}. Kagua na ukubali.',
    },
  },
  match_proposed_farmer: {
    en: {
      title: 'A buyer wants your {{produce}}',
      body: 'A buyer needs {{qty}} {{unit}} of {{produce}} at KES {{price}}/{{unit}} by {{date}}. Accept in the app or dial {{ussd}}.',
    },
    sw: {
      title: 'Mnunuzi anataka {{produce}} yako',
      body: 'Mnunuzi anahitaji {{qty}} {{unit}} za {{produce}} kwa KES {{price}}/{{unit}} kufikia {{date}}. Kubali kwenye programu au piga {{ussd}}.',
    },
  },
  match_accepted: {
    en: { title: 'Deal agreed', body: 'Both sides accepted. Order {{code}} is confirmed.' },
    sw: { title: 'Makubaliano', body: 'Pande zote zimekubali. Oda {{code}} imethibitishwa.' },
  },
  order_new_farmer: {
    en: {
      title: 'New order {{code}}',
      body: 'New order: {{qty}} {{unit}} {{produce}} for {{date}}. Confirm in the app or dial {{ussd}}.',
    },
    sw: {
      title: 'Oda mpya {{code}}',
      body: 'Oda mpya: {{qty}} {{unit}} {{produce}} kwa {{date}}. Thibitisha kwenye programu au piga {{ussd}}.',
    },
  },
  order_confirmed: {
    en: { title: 'Order {{code}} confirmed', body: 'The farmer confirmed order {{code}} for {{date}}.' },
    sw: { title: 'Oda {{code}} imethibitishwa', body: 'Mkulima amethibitisha oda {{code}} ya {{date}}.' },
  },
  order_ready_for_qa: {
    en: {
      title: 'Inspection needed',
      body: 'Order {{code}} is harvested and ready for inspection in {{county}}.',
    },
    sw: { title: 'Ukaguzi unahitajika', body: 'Oda {{code}} imevunwa na iko tayari kukaguliwa {{county}}.' },
  },
  order_qa_passed: {
    en: {
      title: 'Quality check passed',
      body: 'Order {{code}} passed inspection and will be collected soon.',
    },
    sw: { title: 'Ukaguzi umefaulu', body: 'Oda {{code}} imefaulu ukaguzi na itachukuliwa hivi karibuni.' },
  },
  order_qa_rejected: {
    en: { title: 'Quality check failed', body: 'Order {{code}} did not pass inspection: {{reason}}.' },
    sw: { title: 'Ukaguzi haukufaulu', body: 'Oda {{code}} haikufaulu ukaguzi: {{reason}}.' },
  },
  order_in_transit: {
    en: {
      title: 'On the way',
      body: 'Order {{code}} has been collected and is on its way. Track it live in the app.',
    },
    sw: { title: 'Iko njiani', body: 'Oda {{code}} imechukuliwa na iko njiani. Ifuatilie kwenye programu.' },
  },
  order_delivered_buyer: {
    en: {
      title: 'Delivered',
      body: 'Order {{code}} was delivered. Report any problem within {{hours}} hours.',
    },
    sw: {
      title: 'Imefikishwa',
      body: 'Oda {{code}} imefikishwa. Ripoti tatizo lolote ndani ya saa {{hours}}.',
    },
  },
  order_delivered_farmer: {
    en: { title: 'Delivered', body: 'Your order {{code}} was delivered. Payment is on its way.' },
    sw: { title: 'Imefikishwa', body: 'Oda yako {{code}} imefikishwa. Malipo yako yanakuja.' },
  },
  order_cancelled: {
    en: { title: 'Order {{code}} cancelled', body: 'Order {{code}} was cancelled. {{reason}}' },
    sw: { title: 'Oda {{code}} imeghairiwa', body: 'Oda {{code}} imeghairiwa. {{reason}}' },
  },
  order_message: {
    en: { title: 'New message on {{code}}', body: '{{author}}: {{preview}}' },
    sw: { title: 'Ujumbe mpya kwenye {{code}}', body: '{{author}}: {{preview}}' },
  },
  demand_digest: {
    en: {
      title: 'Buyers need {{produce}}',
      body: 'Buyers in {{county}} need {{qty}} {{unit}} of {{produce}} in the week of {{week}}. List your harvest to get matched.',
    },
    sw: {
      title: 'Wanunuzi wanahitaji {{produce}}',
      body: 'Wanunuzi {{county}} wanahitaji {{qty}} {{unit}} za {{produce}} wiki ya {{week}}. Orodhesha mavuno yako upate mnunuzi.',
    },
  },
  payment_success: {
    en: {
      title: 'Payment received',
      body: 'We received KES {{amount}} for {{reference}}.{{#receipt}} Receipt {{receipt}}.{{/receipt}}',
    },
    sw: {
      title: 'Malipo yamepokelewa',
      body: 'Tumepokea KES {{amount}} kwa {{reference}}.{{#receipt}} Risiti {{receipt}}.{{/receipt}}',
    },
  },
  payment_failed: {
    en: {
      title: 'Payment not completed',
      body: 'Your M-Pesa payment for {{reference}} was not completed. Try again from the app.',
    },
    sw: {
      title: 'Malipo hayajakamilika',
      body: 'Malipo yako ya M-Pesa kwa {{reference}} hayajakamilika. Jaribu tena kwenye programu.',
    },
  },
  payout_success: {
    en: {
      title: 'You have been paid',
      body: 'KES {{amount}} sent to your M-Pesa for order {{code}}. Asante!',
    },
    sw: { title: 'Umelipwa', body: 'KES {{amount}} zimetumwa kwa M-Pesa yako kwa oda {{code}}. Asante!' },
  },
  payout_failed_admin: {
    en: { title: 'Payout failed', body: 'Payout for order {{code}} failed: {{reason}}.' },
    sw: { title: 'Malipo kwa mkulima yameshindwa', body: 'Malipo ya oda {{code}} yameshindwa: {{reason}}.' },
  },
  route_assigned: {
    en: { title: 'New route {{code}}', body: 'You have a route on {{date}} with {{stops}} stops.' },
    sw: { title: 'Njia mpya {{code}}', body: 'Una njia tarehe {{date}} yenye vituo {{stops}}.' },
  },
  dispute_opened: {
    en: {
      title: 'Issue reported on {{code}}',
      body: 'The buyer reported a problem ({{reason}}). Our team will review it.',
    },
    sw: {
      title: 'Tatizo limeripotiwa kwenye {{code}}',
      body: 'Mnunuzi ameripoti tatizo ({{reason}}). Timu yetu itakagua.',
    },
  },
  dispute_resolved: {
    en: {
      title: 'Issue resolved on {{code}}',
      body: 'The issue on order {{code}} was resolved: {{outcome}}.',
    },
    sw: {
      title: 'Tatizo limetatuliwa kwenye {{code}}',
      body: 'Tatizo la oda {{code}} limetatuliwa: {{outcome}}.',
    },
  },
  input_order_new: {
    en: {
      title: 'New order for {{product}}',
      body: '{{qty}} {{unit}} of {{product}} ordered. Accept it in the app.',
    },
    sw: {
      title: 'Oda mpya ya {{product}}',
      body: '{{qty}} {{unit}} za {{product}} zimeagizwa. Kubali kwenye programu.',
    },
  },
  input_order_status: {
    en: { title: 'Your {{product}} order', body: 'Your order for {{product}} is now {{status}}.' },
    sw: { title: 'Oda yako ya {{product}}', body: 'Oda yako ya {{product}} sasa ni {{status}}.' },
  },
  crate_return_reminder: {
    en: {
      title: 'Please return crates',
      body: 'You have {{count}} FarmGo crates. Hand them to the driver on the next delivery.',
    },
    sw: {
      title: 'Tafadhali rudisha kreti',
      body: 'Una kreti {{count}} za FarmGo. Mpe dereva kwenye usafirishaji ujao.',
    },
  },
  harvest_reminder: {
    en: {
      title: 'Harvest due',
      body: 'Order {{code}} is due {{date}}. Mark it ready in the app or dial {{ussd}} when harvested.',
    },
    sw: {
      title: 'Wakati wa kuvuna',
      body: 'Oda {{code}} inahitajika {{date}}. Iweke tayari kwenye programu au piga {{ussd}} ukishavuna.',
    },
  },
};

export function render(key: TemplateKey, lang: Language, vars: Record<string, string | number>) {
  const copy = T[key][lang] ?? T[key].en;
  const has = (k: string) => vars[k] !== undefined && vars[k] !== '';
  // `{{#name}}...{{/name}}` is kept only when `name` has a value, so optional clauses drop out cleanly.
  const fill = (s: string) =>
    s
      .replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, k: string, part: string) => (has(k) ? part : ''))
      .replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars[k] ?? ''));
  const title = fill(copy.title);
  const body = fill(copy.body);
  const sms = fill(copy.sms ?? copy.body);
  return { title, body, sms: sms.length > 160 ? `${sms.slice(0, 157)}...` : sms };
}
