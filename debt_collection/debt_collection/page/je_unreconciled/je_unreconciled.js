frappe.pages["je-unreconciled"].on_page_load = function (wrapper) {
	frappe.je_unreconciled = new UnreconciledPage(wrapper);
};

frappe.pages["je-unreconciled"].on_page_show = function () {
	if (frappe.je_unreconciled) frappe.je_unreconciled.load();
};

class UnreconciledPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: "Unreconciled Entries",
			single_column: true,
		});
		this.current_page = 1;
		this.page_size    = 50;
		this.type_filter  = "all"; // all | je | pe
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
				            padding:14px 18px;margin-bottom:20px;font-size:13px;color:#4a5568;line-height:1.6;">
					<strong style="color:#c53030;">⚠️ What are these?</strong><br>
					These entries reduce the Accounts Receivable balance in the GL but are
					<strong>not allocated to any Sales Invoice</strong> — causing a gap between
					this dashboard and the AR report.<br><br>
					<strong>Journal Entry credits</strong> posted against receivable accounts with no invoice link.<br>
					<strong>Payment Entries</strong> with an unallocated amount (received money not matched to invoices).<br><br>
					To fix: use <strong>Payment Reconciliation</strong> to link the entry to the relevant invoice(s).
					Once reconciled the invoice outstanding drops to zero and disappears from debt collection dashboards.
				</div>

				<div id="ur-summary" style="margin-bottom:16px;"></div>

				<!-- Type filter tabs -->
				<div style="display:flex;gap:8px;margin-bottom:16px;">
					${["all","je","pe"].map(t => `
						<button class="ur-tab" data-type="${t}"
						        style="padding:5px 14px;border-radius:20px;font-size:13px;cursor:pointer;
						               border:1px solid ${t==="all"?"#2b6cb0":"#cbd5e0"};
						               background:${t==="all"?"#2b6cb0":"#fff"};
						               color:${t==="all"?"#fff":"#4a5568"};
						               font-weight:${t==="all"?600:400};">
							${{ all:"All", je:"Journal Entries", pe:"Payment Entries" }[t]}
						</button>
					`).join("")}
				</div>

				<div id="ur-table-wrap"></div>
				<div id="ur-pagination" style="margin-top:12px;display:flex;
				                               justify-content:flex-end;align-items:center;gap:8px;"></div>
			</div>
		`);

		$(this.page.body).on("click", ".ur-tab", (e) => {
			$(this.page.body).find(".ur-tab").each((_, el) => {
				$(el).css({ background: "#fff", color: "#4a5568", borderColor: "#cbd5e0", fontWeight: 400 });
			});
			$(e.currentTarget).css({ background: "#2b6cb0", color: "#fff", borderColor: "#2b6cb0", fontWeight: 600 });
			this.type_filter  = $(e.currentTarget).data("type");
			this.current_page = 1;
			this._apply_filter();
		});
	}

	load() {
		frappe.call({
			method: "debt_collection.debt_collection.api.debt_api.get_je_unreconciled",
			args: { page: 1, page_size: 9999 }, // load all, filter client-side for tab switching
			freeze: true, freeze_message: "Loading...",
			callback: (r) => {
				if (!r.message) return;
				this._all_data = r.message.data;
				this._summary  = r.message;
				this._render_summary(r.message);
				this._apply_filter();
			},
		});
	}

	_render_summary(msg) {
		const fmt = (v) => format_currency(v, "KES");
		const stats = [
			{ label: "Total Entries",               value: msg.total,        color: "#c53030" },
			{ label: "Total Unreconciled Amount",   value: fmt(msg.total_amount), color: "#c53030" },
			{ label: "Journal Entry Credits",       value: `${msg.je_count} · ${fmt(msg.je_amount)}`, color: "#dd6b20" },
			{ label: "Unallocated Payment Entries", value: `${msg.pe_count} · ${fmt(msg.pe_amount)}`, color: "#2b6cb0" },
		];
		$("#ur-summary").html(`
			<div style="display:flex;flex-wrap:wrap;background:#fff;border-radius:10px;
			            box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">
				${stats.map((s, i) => `
					<div style="flex:1;min-width:180px;padding:14px 18px;
					            ${i < stats.length - 1 ? "border-right:1px solid #edf2f7;" : ""}">
						<div style="font-size:11px;color:#718096;text-transform:uppercase;
						            letter-spacing:.4px;margin-bottom:3px;">${s.label}</div>
						<div style="font-size:16px;font-weight:700;color:${s.color};">${s.value}</div>
					</div>
				`).join("")}
			</div>
		`);
	}

	_apply_filter() {
		let rows = this._all_data || [];
		if (this.type_filter === "je") rows = rows.filter(r => r.entry_type === "Journal Entry");
		if (this.type_filter === "pe") rows = rows.filter(r => r.entry_type === "Payment Entry");
		const start  = (this.current_page - 1) * this.page_size;
		const paged  = rows.slice(start, start + this.page_size);
		this._render_table(paged);
		this._render_pagination(rows.length);
	}

	_render_table(rows) {
		const fmt = (v) => format_currency(v, "KES");
		const th  = `style="padding:10px 12px;text-align:left;font-weight:600;color:#4a5568;
		                     border-bottom:2px solid #e2e8f0;font-size:12px;white-space:nowrap;"`;
		const td  = (extra) => `style="padding:9px 12px;border-bottom:1px solid #edf2f7;
		                                font-size:13px;color:#2d3748;${extra || ""}"`;

		if (!rows.length) {
			$("#ur-table-wrap").html(`
				<div style="text-align:center;padding:48px;color:#38a169;font-size:14px;">
					✅ No unreconciled entries found.
				</div>
			`);
			return;
		}

		const row_html = rows.map(r => {
			const is_pe    = r.entry_type === "Payment Entry";
			const type_tag = is_pe
				? `<span style="background:#ebf8ff;color:#2b6cb0;padding:2px 8px;border-radius:10px;
				                font-size:11px;font-weight:600;">Payment Entry</span>`
				: `<span style="background:#fefcbf;color:#975a16;padding:2px 8px;border-radius:10px;
				                font-size:11px;font-weight:600;">Journal Entry</span>`;
			const app_url  = is_pe ? "payment-entry" : "journal-entry";
			const recon_url = `/app/payment-reconciliation?party_type=Customer&party=${encodeURIComponent(r.customer)}`;
			return `
				<tr onmouseover="this.style.background='#f7fafc'"
				    onmouseout="this.style.background=''">
					<td ${td()}>${type_tag}</td>
					<td ${td()}>
						<a href="/app/${app_url}/${r.entry_name}" target="_blank"
						   style="color:#2b6cb0;font-weight:600;">${r.entry_name}</a>
					</td>
					<td ${td()}>${r.posting_date || "-"}</td>
					<td ${td("font-weight:600;")}>${r.customer_name || r.customer}</td>
					<td ${td("max-width:220px;font-size:12px;color:#718096;")}>${r.account || "-"}</td>
					<td ${td("font-weight:700;color:#c53030;")}>${fmt(r.unreconciled_amount)}</td>
					<td ${td("max-width:280px;font-size:12px;color:#718096;")}>
						${(r.remarks || "").substring(0, 80)}${(r.remarks||"").length > 80 ? "…" : ""}
					</td>
					<td ${td()}>
						<a href="${recon_url}" target="_blank"
						   style="padding:3px 10px;border:1px solid #2b6cb0;border-radius:4px;
						          background:#ebf8ff;color:#2b6cb0;font-size:11px;
						          font-weight:600;text-decoration:none;">
							Reconcile →
						</a>
					</td>
				</tr>
			`;
		}).join("");

		$("#ur-table-wrap").html(`
			<div style="overflow-x:auto;">
				<table style="width:100%;border-collapse:collapse;background:#fff;
				              border-radius:8px;overflow:hidden;
				              box-shadow:0 1px 3px rgba(0,0,0,.08);">
					<thead style="background:#f7fafc;">
						<tr>
							<th ${th}>Type</th>
							<th ${th}>Entry No.</th>
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
		if (this.current_page > 1) html += `<button ${btn} id="ur-prev">‹ Prev</button>`;
		if (this.current_page < pages) html += `<button ${btn} id="ur-next">Next ›</button>`;
		$("#ur-pagination").html(html);
		$("#ur-prev").on("click", () => { this.current_page--; this._apply_filter(); });
		$("#ur-next").on("click", () => { this.current_page++; this._apply_filter(); });
	}
}
