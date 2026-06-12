frappe.pages["je-unreconciled"].on_page_load = function (wrapper) {
	frappe.je_unreconciled = new JEUnreconciledPage(wrapper);
};

frappe.pages["je-unreconciled"].on_page_show = function () {
	if (frappe.je_unreconciled) frappe.je_unreconciled.load();
};

class JEUnreconciledPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "JE Unreconciled Balances",
			single_column: true,
		});
		this.current_page = 1;
		this.page_size = 50;
		this._setup_toolbar();
		this._render_skeleton();
		this.load();
	}

	_setup_toolbar() {
		this.page.set_primary_action("Refresh", () => this.load(), "refresh");
	}

	_render_skeleton() {
		$(this.page.body).html(`
			<div style="padding:20px;">
				<!-- Info banner -->
				<div style="background:#fff5f5;border:1px solid #fed7d7;border-radius:8px;
				            padding:14px 18px;margin-bottom:20px;">
					<div style="font-weight:600;color:#c53030;font-size:14px;margin-bottom:6px;">
						⚠️ What are these?
					</div>
					<div style="font-size:13px;color:#4a5568;line-height:1.6;">
						These are Journal Entry credits posted against Receivable accounts for customers
						that are <strong>not linked to any Sales Invoice</strong>. They reduce the
						GL balance (Accounts Receivable report) but the invoice
						<code>outstanding_amount</code> remains unchanged — causing the gap you see
						between this dashboard and the AR report.
						<br><br>
						To fix: open the Journal Entry and use
						<strong>Payment Reconciliation</strong> to link it to the relevant invoice(s).
						Once reconciled, the invoice outstanding will be updated to zero and it will
						disappear from the debt collection dashboards.
					</div>
				</div>

				<div id="je-summary" style="margin-bottom:20px;"></div>
				<div id="je-table-wrap"></div>
				<div id="je-pagination" style="margin-top:12px;display:flex;
				                               justify-content:flex-end;align-items:center;gap:8px;">
				</div>
			</div>
		`);
	}

	load() {
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_je_unreconciled",
			args: { page: this.current_page, page_size: this.page_size },
			freeze: true,
			freeze_message: "Loading...",
			callback: (r) => {
				if (!r.message) return;
				this._render_summary(r.message);
				this._render_table(r.message.data);
				this._render_pagination(r.message.total);
			},
		});
	}

	_render_summary(msg) {
		const fmt = (v) => format_currency(v, "KES");
		$("#je-summary").html(`
			<div style="display:flex;gap:0;background:#fff;border-radius:10px;
			            box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">
				<div style="flex:1;padding:16px 20px;border-right:1px solid #edf2f7;">
					<div style="font-size:11px;color:#718096;text-transform:uppercase;
					            letter-spacing:.5px;margin-bottom:4px;">
						Unreconciled Entries
					</div>
					<div style="font-size:22px;font-weight:700;color:#c53030;">${msg.total}</div>
				</div>
				<div style="flex:1;padding:16px 20px;">
					<div style="font-size:11px;color:#718096;text-transform:uppercase;
					            letter-spacing:.5px;margin-bottom:4px;">
						Total Unreconciled Amount
					</div>
					<div style="font-size:22px;font-weight:700;color:#c53030;">
						${fmt(msg.total_amount)}
					</div>
				</div>
			</div>
		`);
	}

	_render_table(rows) {
		const fmt = (v) => format_currency(v, "KES");
		const th  = `style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;
		                     border-bottom:2px solid #e2e8f0;font-size:12px;white-space:nowrap;"`;
		const td  = `style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
		                     color:#2d3748;"`;

		if (!rows.length) {
			$("#je-table-wrap").html(`
				<div style="text-align:center;padding:48px;color:#38a169;font-size:14px;">
					✅ No unreconciled Journal Entry balances found.
				</div>
			`);
			return;
		}

		const row_html = rows.map(r => `
			<tr onmouseover="this.style.background='#f7fafc'"
			    onmouseout="this.style.background=''">
				<td ${td}>
					<a href="/app/journal-entry/${r.journal_entry}" target="_blank"
					   style="color:#2b6cb0;font-weight:600;">${r.journal_entry}</a>
				</td>
				<td ${td}>${r.posting_date || "-"}</td>
				<td ${td} style="padding:9px 12px;border-bottom:1px solid #edf2f7;
				                 font-size:13px;font-weight:600;color:#2d3748;">
					${r.customer_name || r.customer}
				</td>
				<td ${td}>${r.account || "-"}</td>
				<td style="padding:9px 12px;border-bottom:1px solid #edf2f7;font-size:13px;
				           font-weight:700;color:#c53030;">${fmt(r.unreconciled_amount)}</td>
				<td ${td} style="max-width:300px;padding:9px 12px;border-bottom:1px solid #edf2f7;
				                 font-size:12px;color:#718096;">
					${(r.remarks || "").substring(0, 100)}${(r.remarks||"").length > 100 ? "…" : ""}
				</td>
				<td ${td}>
					<a href="/app/payment-reconciliation?party_type=Customer&party=${encodeURIComponent(r.customer)}"
					   target="_blank"
					   style="padding:3px 10px;border:1px solid #2b6cb0;border-radius:4px;
					          background:#ebf8ff;color:#2b6cb0;font-size:11px;
					          font-weight:600;text-decoration:none;">
						Reconcile →
					</a>
				</td>
			</tr>
		`).join("");

		$("#je-table-wrap").html(`
			<div style="overflow-x:auto;">
				<table style="width:100%;border-collapse:collapse;background:#fff;
				              border-radius:8px;overflow:hidden;
				              box-shadow:0 1px 3px rgba(0,0,0,.08);">
					<thead style="background:#f7fafc;">
						<tr>
							<th ${th}>Journal Entry</th>
							<th ${th}>Date</th>
							<th ${th}>Customer</th>
							<th ${th}>Account</th>
							<th ${th}>Unreconciled Amount</th>
							<th ${th}>Remarks</th>
							<th ${th}>Action</th>
						</tr>
					</thead>
					<tbody>${row_html}</tbody>
				</table>
			</div>
		`);
	}

	_render_pagination(total) {
		const pages = Math.ceil(total / this.page_size);
		const start = Math.min((this.current_page - 1) * this.page_size + 1, total);
		const end   = Math.min(this.current_page * this.page_size, total);
		const btn   = `style="padding:4px 12px;border:1px solid #cbd5e0;border-radius:4px;
		                       background:#fff;color:#2b6cb0;font-size:12px;cursor:pointer;"`;
		let html = `<span style="color:#718096;font-size:13px;">${total ? `${start}–${end} of ${total}` : "No records"}</span>`;
		if (this.current_page > 1) html += `<button ${btn} id="je-prev">‹ Prev</button>`;
		if (this.current_page < pages) html += `<button ${btn} id="je-next">Next ›</button>`;
		$("#je-pagination").html(html);
		$("#je-prev").on("click", () => { this.current_page--; this.load(); });
		$("#je-next").on("click", () => { this.current_page++; this.load(); });
	}
}
