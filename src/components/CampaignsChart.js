import ApexCharts from "apexcharts";

export function createTrendChart(el, data) {
    const chart = new ApexCharts(el, {
        chart: {
            type: "line",
            height: 350
        },
        stroke: {
            curve: "smooth"
        },
        series: [
            {
                name: "Leads",
                data: data.leads
            }
        ],
        xaxis: {
            categories: data.dates
        }
    });

    chart.render();
    return chart;
}