import frappe
from frappe.model.document import Document
from frappe.utils import nowdate, getdate
from frappe import sendmail


class CollectionFollowUp(Document):

	def before_save(self):
		# Auto-set collector from customer master
		if self.customer and not self.collector:
			self.collector = frappe.db.get_value("Customer", self.customer, "custom_debt_collector")

	def after_insert(self):
		self.send_follow_up_email()

	def on_update(self):
		if self.flags.email_sent:
			return
		self.send_follow_up_email()
		self.flags.email_sent = True

	def send_follow_up_email(self):
		"""Send follow-up email to contact person and CC the debt collector."""
		recipients = []
		cc_list = []

		# Primary recipient: contact person email
		if self.contact_person:
			contact_email = frappe.db.get_value("Contact", self.contact_person, "email_id")
			if contact_email:
				recipients.append(contact_email)

		if not recipients:
			# Fall back to customer primary email
			customer_email = frappe.db.get_value("Customer", self.customer, "email_id")
			if customer_email:
				recipients.append(customer_email)

		if not recipients:
			frappe.log_error(
				f"No recipient email found for Follow Up {self.name} on customer {self.customer}",
				"Collection Follow Up Email"
			)
			return

		# CC: debt collector user
		if self.collector:
			collector_email = frappe.db.get_value("User", self.collector, "email")
			if collector_email:
				cc_list.append(collector_email)

		# CC: additional contacts from cc_contacts field
		if self.cc_contacts:
			extra = [e.strip() for e in self.cc_contacts.replace("\n", ",").split(",") if e.strip()]
			cc_list.extend(extra)

		# Build email body
		subject = f"Payment Follow-Up: {self.customer_name or self.customer}"
		message = self._build_email_body()

		try:
			sendmail(
				recipients=recipients,
				cc=cc_list,
				subject=subject,
				message=message,
				reference_doctype=self.doctype,
				reference_name=self.name,
			)
			frappe.msgprint(
				f"Follow-up email sent to {', '.join(recipients)}",
				indicator="green",
				alert=True,
			)
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), "Collection Follow Up Email Error")

	def _build_email_body(self):
		"""Build an HTML email body for the follow-up."""
		contact_name = self.contact_person or "Sir/Madam"
		collector_name = frappe.db.get_value("User", self.collector, "full_name") if self.collector else ""

		invoice_rows = ""
		for inv in self.invoices:
			invoice_rows += f"""
			<tr>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;">{inv.sales_invoice}</td>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;">{inv.invoice_date or ''}</td>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;">{inv.due_date or ''}</td>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;color:#e53e3e;font-weight:bold;">{inv.overdue_days or 0} days</td>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">
					{frappe.utils.fmt_money(inv.outstanding_amount, currency='KES')}
				</td>
				<td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">
					{frappe.utils.fmt_money(inv.net_outstanding, currency='KES')}
				</td>
			</tr>
			"""

		invoice_table = ""
		if invoice_rows:
			invoice_table = f"""
			<h3 style="color:#2d3748;margin-top:24px;">Outstanding Invoices</h3>
			<table style="width:100%;border-collapse:collapse;font-size:13px;">
				<thead>
					<tr style="background:#f7fafc;">
						<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;">Invoice No.</th>
						<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;">Invoice Date</th>
						<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;">Due Date</th>
						<th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e2e8f0;">Overdue Days</th>
						<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0;">Outstanding Amt</th>
						<th style="padding:8px 10px;text-align:right;border-bottom:2px solid #e2e8f0;">Net Outstanding</th>
					</tr>
				</thead>
				<tbody>{invoice_rows}</tbody>
			</table>
			"""

		return f"""
		<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;color:#2d3748;">
			<div style="background:linear-gradient(135deg,#1a365d,#2b6cb0);padding:24px 32px;border-radius:8px 8px 0 0;">
				<h2 style="color:#fff;margin:0;font-size:22px;">Payment Follow-Up Notice</h2>
				<p style="color:#bee3f8;margin:4px 0 0;">Outstanding Balance Reminder</p>
			</div>
			<div style="background:#fff;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
				<p>Dear {contact_name},</p>
				<p>This is a follow-up regarding the outstanding balance on your account with us.
				   We would like to draw your attention to the invoices listed below that are currently overdue.</p>

				<div style="background:#fff5f5;border-left:4px solid #e53e3e;padding:12px 16px;border-radius:4px;margin:16px 0;">
					<strong>Method of Contact:</strong> {self.contact_method}<br/>
					<strong>Next Follow-Up Date:</strong> {self.next_follow_up_date or 'TBD'}
				</div>

				{invoice_table}

				<div style="margin-top:24px;background:#f7fafc;padding:16px;border-radius:6px;">
					<strong>Remarks:</strong>
					<p style="margin:8px 0 0;">{self.remarks or ''}</p>
				</div>

				<p style="margin-top:24px;">
					Please arrange for prompt payment or contact us to discuss payment arrangements.
				</p>

				<p style="color:#718096;font-size:12px;margin-top:32px;border-top:1px solid #e2e8f0;padding-top:16px;">
					This communication was sent by {collector_name or 'the Collections Team'}.
					For queries, please reply to this email.
				</p>
			</div>
		</div>
		"""
