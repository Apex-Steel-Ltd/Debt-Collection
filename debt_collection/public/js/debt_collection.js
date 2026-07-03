/**
 * Debt Collection — Shared JS utilities
 * Loaded globally via app_include_js in hooks.py
 */

/**
 * Show a customer invoice dialog.
 *
 * @param {string} customer        — customer ID
 * @param {Array}  invoices        — from get_customer_invoices API
 * @param {Array}  ageing          — [{label, amount}] ordered array
 * @param {object} opts
 *   show_follow_up {boolean}  — show checkbox column and "Start Follow Up" button (default: false)
 *   plan_name      {string}   — pre-populate Weekly Collection Plan on the follow-up form
 */
window.dc_show_customer_invoices = function(customer, invoices, ageing, opts) {
	opts = opts || {};
	const fmt    = (v) => format_currency(v, "KES");
	const with_fu = !!opts.show_follow_up;

	// ── Ageing buckets ───────────────────────────────────────────────────────
	const ageing_html = (ageing || []).map(b => `
		<div style="background:#f7fafc;border:1px solid #e2e8f0;border-radius:8px;
		            padding:10px 14px;min-width:120px;">
			<div style="font-size:11px;color:#718096;margin-bottom:3px;">${b.label}</div>
			<div style="font-size:15px;font-weight:700;color:#2d3748;">${fmt(b.amount)}</div>
		</div>
	`).join("");

	// ── Invoice rows ─────────────────────────────────────────────────────────
	const th = (w) => `style="padding:7px 10px;text-align:left;font-size:11px;font-weight:600;
	                           color:#4a5568;border-bottom:2px solid #e2e8f0;white-space:nowrap;
	                           ${w ? "width:" + w + ";" : ""}"`;
	const td = (extra) => `style="padding:7px 10px;border-bottom:1px solid #edf2f7;
	                                font-size:12px;color:#2d3748;${extra || ""}"`;

	const invoice_rows = invoices.map((inv, i) => `
		<tr onmouseover="this.style.background='#f7fafc'" onmouseout="this.style.background=''">
			${with_fu ? `<td ${td()}><input type="checkbox" class="dci-check" data-idx="${i}"></td>` : ""}
			<td ${td()}>${i + 1}</td>
			<td ${td()}>
				<a href="/app/sales-invoice/${inv.name}" target="_blank"
				   style="color:#2b6cb0;">${inv.name}</a>
			</td>
			<td ${td()}>${inv.payment_terms || "-"}</td>
			<td ${td()}>${inv.invoice_date || "-"}</td>
			<td ${td()}>${inv.due_date || "-"}</td>
			<td ${td(`font-weight:700;color:${inv.overdue_days > 90 ? "#e53e3e" : inv.overdue_days > 30 ? "#dd6b20" : "#2d3748"};`)}>
				${inv.overdue_days}
			</td>
			<td ${td()}>${fmt(inv.invoice_amount)}</td>
			<td ${td("font-weight:600;")}>${fmt(inv.outstanding_amount)}</td>
			<td ${td(`color:${inv.pdc_amount > 0 ? "#d69e2e" : "#a0aec0"};font-weight:${inv.pdc_amount > 0 ? 600 : 400};`)}>
				${fmt(inv.pdc_amount)}
			</td>
			<td ${td("font-weight:700;color:#2b6cb0;")}>${fmt(inv.net_outstanding)}</td>
			<td ${td("color:#718096;")}>${inv.pdc_date || "-"}</td>
		</tr>
	`).join("");

	const cols = with_fu ? 12 : 11;

	const dialog_opts = {
		title: customer,
		size: "extra-large",
		fields: [{
			fieldtype: "HTML",
			options: `
				<p style="color:#718096;font-size:12px;text-transform:uppercase;
				          letter-spacing:1px;margin-bottom:10px;">
					Invoices and Follow Up Details
				</p>
				<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;">
					${ageing_html}
				</div>
				<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
					<div>
						<div style="font-weight:700;font-size:15px;">Outstanding Invoices</div>
						<div style="color:#718096;font-size:12px;">
							${invoices.length} pending invoice${invoices.length !== 1 ? "s" : ""}
						</div>
					</div>
					${with_fu ? `
					<label style="display:flex;align-items:center;gap:6px;font-size:13px;
					              color:#4a5568;cursor:pointer;font-weight:600;">
						<input type="checkbox" id="dci-select-all"
						       style="width:14px;height:14px;cursor:pointer;">
						Select All
					</label>` : ""}
				</div>
				<div style="overflow-x:auto;">
					<table style="width:100%;border-collapse:collapse;font-size:12px;background:#fff;">
						<thead style="background:#f7fafc;">
							<tr>
								${with_fu ? `<th ${th("30px")}></th>` : ""}
								<th ${th()}>#</th>
								<th ${th()}>Trx No.</th>
								<th ${th()}>Terms</th>
								<th ${th()}>Inv Date</th>
								<th ${th()}>Due Date</th>
								<th ${th()}>Days</th>
								<th ${th()}>Inv Amt</th>
								<th ${th()}>Outstanding</th>
								<th ${th()}>PDC Amt</th>
								<th ${th()}>Net Outstanding</th>
								<th ${th()}>PDC Date</th>
							</tr>
						</thead>
						<tbody>${invoice_rows || `<tr><td colspan="${cols}"
						    style="text-align:center;padding:20px;color:#a0aec0;">
						    No outstanding invoices.</td></tr>`}</tbody>
					</table>
				</div>
			`,
		}],
	};

	if (with_fu) {
		dialog_opts.primary_action_label = "Start Follow Up";
		dialog_opts.primary_action = () => {
			const selected = [];
			d.$wrapper.find(".dci-check:checked").each((_, el) => {
				const inv = invoices[parseInt($(el).data("idx"))];
				if (inv) selected.push({
					sales_invoice:      inv.name,
					invoice_date:       inv.invoice_date,
					due_date:           inv.due_date,
					overdue_days:       inv.overdue_days,
					invoice_amount:     inv.invoice_amount,
					outstanding_amount: inv.outstanding_amount,
					pdc_amount:         inv.pdc_amount,
					pdc_date:           inv.pdc_date,
					net_outstanding:    inv.net_outstanding,
					payment_terms:      inv.payment_terms,
				});
			});
			d.hide();
			// Store invoices in sessionStorage to avoid URL encoding issues
			sessionStorage.setItem("dc_followup_invoices", JSON.stringify(selected));
			// Navigate with only safe scalar params in URL
			let url = `/app/collection-follow-up-form?customer=${encodeURIComponent(customer)}`;
			if (opts.plan_name) url += `&weekly_collection_plan=${encodeURIComponent(opts.plan_name)}`;
			window.location.href = url;
		};
	}

	const d = new frappe.ui.Dialog(dialog_opts);
	d.show();

	// Wire Select All after dialog renders
	if (with_fu) {
		setTimeout(() => {
			d.$wrapper.find("#dci-select-all").on("change", function() {
				d.$wrapper.find(".dci-check").prop("checked", this.checked);
			});
		}, 100);
	}
};
