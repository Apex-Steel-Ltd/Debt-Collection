frappe.pages['collection-performance'].on_page_load = function(wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: 'Collection Performance Dashboard',
		single_column: true
	});

	const inp = `style="height:28px;border:1px solid #cbd5e0;border-radius:4px;padding:0 8px;
						font-size:12px;color:#2d3748;background:#fff;outline:none;"`;
	const lbl = `style="font-size:11px;color:#718096;margin-bottom:3px;display:block;
						text-transform:uppercase;letter-spacing:.4px;"`;

	// Setup basic HTML structure
	$(wrapper).find('.layout-main-section').html(`
		<style>
			.cp-dashboard {
				padding: 20px;
				font-family: 'Inter', sans-serif;
			}
			.cp-summary-cards {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
				gap: 20px;
				margin-bottom: 30px;
			}
			.cp-card {
				background: #fff;
				border-radius: 12px;
				padding: 24px;
				box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
				border: 1px solid #e2e8f0;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				transition: transform 0.2s ease, box-shadow 0.2s ease;
			}
			.cp-card:hover {
				transform: translateY(-2px);
				box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
			}
			.cp-card-title {
				font-size: 14px;
				color: #64748b;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				font-weight: 600;
				margin-bottom: 8px;
			}
			.cp-card-value {
				font-size: 32px;
				font-weight: 700;
				color: #0f172a;
			}
			.cp-card.primary {
				background: linear-gradient(135deg, #1e293b, #0f172a);
			}
			.cp-card.primary .cp-card-title,
			.cp-card.primary .cp-card-value {
				color: #f8fafc;
			}
			.cp-ring-container {
				position: relative;
				width: 120px;
				height: 120px;
				margin-bottom: 16px;
			}
			.cp-ring-svg {
				transform: rotate(-90deg);
			}
			.cp-ring-circle-bg {
				fill: none;
				stroke: #e2e8f0;
				stroke-width: 8;
			}
			.cp-ring-circle {
				fill: none;
				stroke: #3b82f6;
				stroke-width: 8;
				stroke-linecap: round;
				transition: stroke-dasharray 1s ease-out;
			}
			.cp-ring-text {
				position: absolute;
				top: 50%;
				left: 50%;
				transform: translate(-50%, -50%);
				font-size: 24px;
				font-weight: 700;
				color: #0f172a;
			}
			.cp-table-container {
				background: #fff;
				border-radius: 12px;
				box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
				border: 1px solid #e2e8f0;
				overflow: hidden;
			}
			.cp-table {
				width: 100%;
				border-collapse: collapse;
			}
			.cp-table th {
				background: #f8fafc;
				padding: 12px 24px;
				text-align: left;
				font-size: 13px;
				font-weight: 600;
				color: #475569;
				text-transform: uppercase;
				letter-spacing: 0.5px;
				border-bottom: 2px solid #e2e8f0;
			}
			.cp-table td {
				padding: 16px 24px;
				font-size: 14px;
				color: #334155;
				border-bottom: 1px solid #e2e8f0;
			}
			.cp-table tr:last-child td {
				border-bottom: none;
			}
			.cp-table tr:hover {
				background-color: #f8fafc;
			}
			.cp-progress-bar {
				height: 8px;
				background: #e2e8f0;
				border-radius: 4px;
				overflow: hidden;
				margin-top: 6px;
			}
			.cp-progress-fill {
				height: 100%;
				background: #3b82f6;
				border-radius: 4px;
				transition: width 1s ease-out;
			}
			.cp-collector-name {
				font-weight: 600;
				color: #0f172a;
			}
			.cp-amount {
				font-variant-numeric: tabular-nums;
			}
		</style>
		<div class="cp-dashboard">
			<!-- Filter bar -->
			<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;
						background:#fff;border:1px solid #e2e8f0;border-radius:8px;
						padding:12px 16px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.05);">
				<div>
					<label ${lbl}>From Date</label>
					<input type="date" id="cp-from-date" ${inp}>
				</div>
				<div>
					<label ${lbl}>To Date</label>
					<input type="date" id="cp-to-date" ${inp}>
				</div>
				<button id="cp-clear-filters"
						style="height:28px;padding:0 12px;border:1px solid #cbd5e0;
							   border-radius:4px;background:#fff;color:#718096;
							   font-size:12px;cursor:pointer;">
					Clear Filters
				</button>
			</div>

			<div id="cp-loading" style="text-align:center; padding: 40px; color: #64748b;">
				<i class="fa fa-spinner fa-spin fa-2x"></i>
				<p style="margin-top: 10px;">Loading Performance Data...</p>
			</div>
			<div id="cp-content" style="display: none;">
				<div class="cp-summary-cards" id="cp-summary"></div>
				<div class="cp-table-container">
					<table class="cp-table">
						<thead>
							<tr>
								<th>Sales Person</th>
								<th>Assigned Customers</th>
								<th>Total Outstanding</th>
								<th>Amount Collected</th>
								<th>Performance</th>
							</tr>
						</thead>
						<tbody id="cp-table-body"></tbody>
					</table>
				</div>
			</div>
		</div>
	`);

	// Setup events
	$(wrapper).on("change", "#cp-from-date, #cp-to-date", function() {
		load_data();
	});

	$(wrapper).on("click", "#cp-clear-filters", function() {
		$("#cp-from-date").val("");
		$("#cp-to-date").val("");
		load_data();
	});

	page.set_primary_action('Refresh', () => load_data(), 'refresh');
	load_data();

	function load_data() {
		$('#cp-loading').show();
		$('#cp-content').hide();
		
		let from_date = $('#cp-from-date').val();
		let to_date = $('#cp-to-date').val();
		
		frappe.call({
			method: 'debt_collection.debt_collection.page.collection_performance.collection_performance.get_performance_data',
			args: {
				from_date: from_date,
				to_date: to_date
			},
			callback: function(r) {
				if (r.message) {
					render_dashboard(r.message);
				}
			}
		});
	}

	function render_dashboard(data) {
		const fmt = (v) => format_currency(v, "KES");
		const summary = data.summary;
		const rows = data.data;

		// Calculate circle properties
		const radius = 52;
		const circumference = 2 * Math.PI * radius;
		const dashoffset = circumference - (summary.overall_percent / 100) * circumference;

		const ringColor = summary.overall_percent >= 80 ? '#22c55e' : (summary.overall_percent >= 50 ? '#eab308' : '#3b82f6');

		// Render Summary
		$('#cp-summary').html(`
			<div class="cp-card">
				<div class="cp-ring-container">
					<svg class="cp-ring-svg" width="120" height="120">
						<circle class="cp-ring-circle-bg" cx="60" cy="60" r="${radius}"></circle>
						<circle class="cp-ring-circle" cx="60" cy="60" r="${radius}" 
							stroke="${ringColor}"
							stroke-dasharray="${circumference}" 
							stroke-dashoffset="${circumference}"
							style="stroke-dashoffset: ${dashoffset}"></circle>
					</svg>
					<div class="cp-ring-text">${summary.overall_percent}%</div>
				</div>
				<div class="cp-card-title">Overall Performance</div>
			</div>
			<div class="cp-card primary">
				<div class="cp-card-title">Total Outstanding</div>
				<div class="cp-card-value">${fmt(summary.total_planned)}</div>
			</div>
			<div class="cp-card" style="border-bottom: 4px solid #22c55e;">
				<div class="cp-card-title">Total Collected</div>
				<div class="cp-card-value" style="color: #22c55e;">${fmt(summary.total_collected)}</div>
			</div>
		`);

		// Render Table
		let html = '';
		if (rows.length === 0) {
			html = '<tr><td colspan="5" style="text-align:center; padding: 30px; color: #64748b;">No active plans found.</td></tr>';
		} else {
			rows.forEach(row => {
				const color = row.collection_percent >= 80 ? '#22c55e' : (row.collection_percent >= 50 ? '#eab308' : '#3b82f6');
				html += `
					<tr>
						<td>
							<div class="cp-collector-name">${row.collector}</div>
						</td>
						<td>${row.customers_assigned}</td>
						<td class="cp-amount">${fmt(row.total_planned)}</td>
						<td class="cp-amount" style="font-weight: 600;">${fmt(row.total_collected)}</td>
						<td style="width: 250px;">
							<div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: ${color};">
								<span>${row.collection_percent}%</span>
							</div>
							<div class="cp-progress-bar">
								<div class="cp-progress-fill" style="width: 0%; background: ${color};" data-width="${row.collection_percent}%"></div>
							</div>
						</td>
					</tr>
				`;
			});
		}
		
		$('#cp-table-body').html(html);
		
		$('#cp-loading').hide();
		$('#cp-content').fadeIn(300);

		// Animate progress bars after slight delay
		setTimeout(() => {
			$('.cp-progress-fill').each(function() {
				$(this).css('width', $(this).data('width'));
			});
		}, 100);
	}
};
