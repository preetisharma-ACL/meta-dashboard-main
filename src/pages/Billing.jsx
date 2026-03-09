export function Billing() {

    const billing = {
        committed: "₹2,00,000",
        utilized: "₹1,25,000",
        remaining: "₹75,000",
        pending: "₹25,000"
    };

    const cplData = {
        totalLeads: 320,
        totalSpend: "₹1,25,000",
        avgCPL: "₹390"
    };

    const invoices = [
        {
            date: "12 Feb 2026",
            invoice: "INV-1021",
            amount: "₹50,000",
            status: "Paid"
        },
        {
            date: "05 Jan 2026",
            invoice: "INV-1013",
            amount: "₹75,000",
            status: "Paid"
        },
        {
            date: "01 Mar 2026",
            invoice: "INV-1030",
            amount: "₹25,000",
            status: "Pending"
        }
    ];

    return (
        <div class="p-6 bg-gray-50 dark:bg-gray-900 min-h-screen">

            {/* Header */}
            <div class="mb-8">
                <h1 class="text-xl font-semibold text-gray-700 dark:text-white">
                    Manage Billing and Transactions
                </h1>

                <p class="text-gray-600 dark:text-gray-400 mt-2">
                    Manage your financial overview and campaign budgets
                </p>

                <p class="text-sm text-gray-500 mt-1">
                    *All amounts shown excluding GST
                </p>
            </div>

            {/* Budget Overview */}
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 mb-10">

                <div class="bg-[#f4f7ca] dark:bg-gray-800 rounded p-6 border border-[#e3e996]">
                    <p class="text-sm text-[#868d2b] dark:text-gray-300">Total Budget Committed</p>
                    <h3 class="text-xl font-semibold mt-2">{billing.committed}</h3>
                </div>

                <div class="bg-blue-50 dark:bg-gray-800 rounded p-6 border border-blue-200">
                    <p class="text-sm text-blue-800 dark:text-gray-300">Budget Utilized</p>
                    <h3 class="text-xl font-semibold mt-2">{billing.utilized}</h3>
                </div>

                <div class="bg-green-50 dark:bg-gray-800 rounded p-6 border border-green-200">
                    <p class="text-sm text-green-800 dark:text-gray-300">Remaining Balance</p>
                    <h3 class="text-xl font-semibold text-green-600 mt-2">{billing.remaining}</h3>
                </div>

                <div class="bg-red-50 dark:bg-gray-800 rounded p-6 border border-red-200">
                    <p class="text-sm text-red-800 dark:text-gray-300">Pending Payment</p>
                    <h3 class="text-xl font-semibold text-red-500 mt-2">{billing.pending}</h3>
                </div>

            </div>


            {/* CPL Transparency Section */}
            <div class="mb-10">

                <h2 class="text-lg font-semibold text-gray-700 dark:text-white mb-4">
                    CPL Calculation Transparency
                </h2>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">

                    <div class="bg-white dark:bg-gray-800 p-6 rounded border shadow-sm">
                        <p class="text-sm text-gray-500 dark:text-gray-300">Total Leads Generated</p>
                        <h3 class="text-xl font-semibold mt-2">{cplData.totalLeads}</h3>
                    </div>

                    <div class="bg-white dark:bg-gray-800 p-6 rounded border shadow-sm">
                        <p class="text-sm text-gray-500 dark:text-gray-300">Total Spend</p>
                        <h3 class="text-xl font-semibold mt-2">{cplData.totalSpend}</h3>
                    </div>

                    <div class="bg-white dark:bg-gray-800 p-6 rounded border shadow-sm">
                        <p class="text-sm text-gray-500 dark:text-gray-300">Average CPL</p>
                        <h3 class="text-xl font-semibold text-blue-600 mt-2">{cplData.avgCPL}</h3>
                    </div>

                </div>

                <p class="text-sm text-gray-500 dark:text-gray-300 mt-4">
                    CPL = Total Spend ÷ Total Leads (Excluding GST)
                </p>

            </div>


            {/* Payment & Invoice Tracking */}
            <div>

                <h2 class="text-lg font-semibold text-gray-700 dark:text-white mb-4">
                    Payment & Invoice Tracking
                </h2>

                <div class="bg-white dark:bg-gray-800 rounded-xl border shadow-sm overflow-x-auto">

                    <table class="w-full text-sm text-left">

                        <thead class="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                            <tr>
                                <th class="p-4">Date</th>
                                <th class="p-4">Invoice Number</th>
                                <th class="p-4">Amount</th>
                                <th class="p-4">Status</th>
                            </tr>
                        </thead>

                        <tbody>
                            {invoices.map((inv) => (
                                <tr class="border-t dark:border-gray-700">

                                    <td class="p-4">{inv.date}</td>
                                    <td class="p-4">{inv.invoice}</td>
                                    <td class="p-4">{inv.amount}</td>

                                    <td class="p-4">
                                        <span class={
                                            inv.status === "Paid"
                                                ? "text-green-600 font-medium"
                                                : "text-red-500 font-medium"
                                        }>
                                            {inv.status}
                                        </span>
                                    </td>

                                </tr>
                            ))}
                        </tbody>

                    </table>

                </div>

            </div>

        </div>
    );
}