import { Worker } from 'bullmq';

export const createEmailWorker = ({ queueName, connection, sendEmail }) => {
    return new Worker(
        queueName,
        async (job) => {
            console.log('Worker received job:', job.id);
            console.log('Job name:', job.name);
            console.log('Job data:', job.data);

            if (
                [
                    'order-confirmation-email',
                    'refund-requested-email',
                    'refund-approved-email',
                    'refund-rejected-email',
                    'payout-paid-email',
                    'payout-failed-email',
                ].includes(job.name)
            ) {
                await sendEmail({
                    type: job.name,
                    ...job.data,
                });
            }
        },
        {
            connection,
        },
    );
};
