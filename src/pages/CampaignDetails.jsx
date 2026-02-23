import { useParams } from "@solidjs/router";

export default function CampaignDetails() {
    const params = useParams();

    return (
        <div class="p-6">
            <h1 class="text-2xl font-bold">
                Campaign ID: {params.id}
            </h1>

            {/* Fetch campaign using params.id */}
        </div>
    );
}
