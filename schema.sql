SELECT u.first_name, cp.status
FROM campaign_participants cp
JOIN users u ON cp.user_id = u.user_id
WHERE cp.campaign_id = 2;